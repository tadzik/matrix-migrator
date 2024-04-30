import * as sdk from "matrix-js-sdk";
import Semaphore from "@chriscdn/promise-semaphore";

import { HistoryVisibility, JoinRule } from "./sdk-helpers";
import { IncompleteStateError, MigratorError, RoomTombstonedError } from "./errors";

interface ProfileInfo {
    displayname?: string,
    avatar_url?: string,
}

export interface MigratableRoom {
    roomId: string,
    roomName?: string,
    roomProfileInfo: ProfileInfo, // TODO
    joinRule: JoinRule,
    requiredRooms?: Set<string>,
    historyVisibility: sdk.HistoryVisibility,
    powerLevels: sdk.IPowerLevelsContent,
    problems: MigratorError[],
}

interface UnavailableRoom {
    roomId: string,
    reason: MigratorError,
}

// type GenericAccountData = { [key: string]: object };
export type DirectMessages = { [mxid: string]: string[] }
export interface IgnoredUserList {
    ignored_users: {
        [mxid: string]: Record<string, never>, // literally {}, but eslint bitches about that
    }
}

export interface Account {
    profileInfo: ProfileInfo,

    directMessages: DirectMessages,
    ignoredUsers:   IgnoredUserList,
    pushRules:      sdk.IPushRules,
    secretStorage:  Map<string, unknown>,

    migratableRooms: Set<MigratableRoom>,
    unavailableRooms: Set<UnavailableRoom>,
}

function getStateEvent(state: sdk.IStateEvent[], type: string): sdk.IContent {
    const eventContent = state.find(ev => ev.type === type)
    if (!eventContent) throw new IncompleteStateError(type);
    return eventContent;
}

async function collectRoom(client: sdk.MatrixClient, roomId: string): Promise<MigratableRoom> {
    const state = await client.roomState(roomId);

    let roomName;
    try {
        roomName = getStateEvent(state, 'm.room.name')!.content.name;
    } catch (err: unknown) {
        // derive from room members
        const roomMembers = state.filter(
            ev => ev.type === 'm.room.member' && ev.state_key != client.getUserId() && ev.content.membership === 'join'
        ).map(ev => ev.content.displayname);
        if (roomMembers.length > 1) {
            roomName = `Chat with ${roomMembers.join(', ')}`;
        } else {
            roomName = `DM with ${roomMembers.join(', ')}`;
        }
    }

    const tombstoneEvent = state.find(ev => ev.type === 'm.room.tombstone');
    if (tombstoneEvent) {
        throw new RoomTombstonedError(roomName, tombstoneEvent.content.replacement_room, tombstoneEvent.content.body);
    }

    const joinRuleContent = getStateEvent(state, 'm.room.join_rules');
    const joinRule = JoinRule.fromContent(joinRuleContent);
    let requiredRooms: Set<string>|undefined;
    if (joinRule === JoinRule.Restricted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        requiredRooms = new Set(joinRuleContent.content.allow?.map((rule: any) => rule['room_id']));
    }
    const historyVisibility = HistoryVisibility.fromContent(getStateEvent(state, 'm.room.history_visibility'));

    const powerLevels = getStateEvent(state, 'm.room.power_levels').content as sdk.IPowerLevelsContent;

    return {
        roomId,
        roomName,
        roomProfileInfo: {},
        joinRule,
        requiredRooms,
        historyVisibility,
        powerLevels,
        problems: [],
    };
}

export async function collectAccount(client: sdk.MatrixClient): Promise<Account> {
    const accountData = new Map<string, unknown>();
    const accountDataPromise = new Promise<void>(resolve => {
        client.on(sdk.ClientEvent.AccountData, ev => {
            accountData.set(ev.getType(), ev.getContent());
        });
        client.on(sdk.ClientEvent.Sync, () => resolve());
    });
    await client.startClient();
    await accountDataPromise;
    const directMessages = accountData.get('m.direct') as DirectMessages ?? {};
    const ignoredUsers   = accountData.get('m.ignored_user_list') as IgnoredUserList ?? { ignored_users: {} };
    const pushRules      = await client.getPushRules();

    const secretStorage = new Map();
    const secretPrefixes = ['m.secret_storage', 'm.cross_signing', 'm.megolm_backup.v1'];
    for (const [key, value] of accountData.entries()) {
        if (secretPrefixes.some(prefix => key.startsWith(prefix))) {
            secretStorage.set(key, value);
        }
    }

    const profileInfo = await client.getProfileInfo(client.getUserId()!);

    const joinedRooms = (await client.getJoinedRooms()).joined_rooms;
    let collected = 0;
    const reportProgress = () => {
        process.stderr.write('\r');
        if (++collected < joinedRooms.length) {
            process.stderr.write(`Collected ${collected}/${joinedRooms.length} rooms...`);
        }
    }

    const migratableRooms = new Set<MigratableRoom>();
    const unavailableRooms = new Set<UnavailableRoom>();
    const sem = new Semaphore(10); // so that we don't open hundreds of connections at once

    await Promise.all(joinedRooms.map(async roomId => {
        await sem.acquire();
        await collectRoom(client, roomId).then(
            room => migratableRooms.add(room)
        ).catch(
            reason => unavailableRooms.add({ roomId, reason })
        );
        sem.release();
        reportProgress();
    }));

    return {
        profileInfo,
        migratableRooms,
        unavailableRooms,
        directMessages,
        ignoredUsers,
        pushRules,
        secretStorage,
    };
}

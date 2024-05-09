import * as sdk from "matrix-js-sdk";
import Semaphore from "@chriscdn/promise-semaphore";

import { HistoryVisibility, JoinRule } from "./sdk-helpers";
import { IncompleteStateError, MigratorError, RoomTombstonedError } from "./errors";

export interface ProfileInfo {
    displayname?: string,
    avatar_url?: string,
}

export interface MigratableRoom {
    roomId: string,
    roomName?: string,
    roomAvatar?: string,
    roomProfileInfo: ProfileInfo, // TODO
    joinRule: JoinRule,
    requiredRooms?: Set<string>,
    historyVisibility: sdk.HistoryVisibility,
    powerLevels: sdk.IPowerLevelsContent,
    problems: MigratorError[],
}

export interface UnavailableRoom {
    roomId: string,
    roomName?: string,
    roomAvatar?: string,
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

    migratableRooms: Set<MigratableRoom>,
    unavailableRooms: Set<UnavailableRoom>,
}

function getStateEvent(state: sdk.IStateEvent[], type: string): sdk.IContent {
    const eventContent = state.find(ev => ev.type === type)
    if (!eventContent) throw new IncompleteStateError(type);
    return eventContent;
}

export class FatalMigratorError extends Error {
    constructor(
        public reason: MigratorError,
        public roomName?: string,
        public roomAvatar?: string,
    ) {
        super(reason.toString());
    }
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
    const roomAvatar = state.find(ev => ev.type === 'm.room.avatar')?.content.url;

    const tombstoneEvent = state.find(ev => ev.type === 'm.room.tombstone');
    if (tombstoneEvent) {
        throw new FatalMigratorError(
            new RoomTombstonedError(roomName, tombstoneEvent.content.replacement_room, tombstoneEvent.content.body),
            roomName,
            roomAvatar,
        );
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
        roomAvatar,
        roomProfileInfo: {},
        joinRule,
        requiredRooms,
        historyVisibility,
        powerLevels,
        problems: [],
    };
}

export async function collectAccount(client: sdk.MatrixClient, progressTracker?: (msg: string, count?: number, total?: number) => void): Promise<Account> {
    progressTracker?.("Collecting account data");
    const directMessages = await client.getAccountDataFromServer('m.direct') ?? {};
    const ignoredUsers   = await client.getAccountDataFromServer('m.ignored_user_list') as IgnoredUserList ?? { ignored_users: {} };
    const pushRules      = await client.getPushRules();

    progressTracker?.("Collecting profile information");
    const profileInfo = await client.getProfileInfo(client.getUserId()!);

    progressTracker?.("Collecting joined rooms");
    const joinedRooms = (await client.getJoinedRooms()).joined_rooms;
    let collected = 0;
    const reportProgress = () => progressTracker?.("Collecting joined rooms", ++collected, joinedRooms.length);

    const migratableRooms = new Set<MigratableRoom>();
    const unavailableRooms = new Set<UnavailableRoom>();
    const sem = new Semaphore(10); // so that we don't open hundreds of connections at once

    await Promise.all(joinedRooms.map(async roomId => {
        await sem.acquire();
        await collectRoom(client, roomId).then(
            room => migratableRooms.add(room)
        ).catch(
            err => {
                if (err instanceof FatalMigratorError) {
                    unavailableRooms.add({
                        roomId,
                        roomName: err.roomName,
                        roomAvatar: err.roomAvatar,
                        reason: err.reason,
                    })
                } else {
                    unavailableRooms.add({ roomId, reason: err });
                }
            }
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
    };
}

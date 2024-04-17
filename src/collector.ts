import * as sdk from "matrix-js-sdk";
import Semaphore from "@chriscdn/promise-semaphore";

import { HistoryVisibility, JoinRule } from "./sdk-helpers";
import { IncompleteStateError, MigratorError } from "./errors";

interface ProfileInfo {
    displayname?: string,
    avatar_url?: string,
}

export interface MigratableRoom {
    roomId: string,
    roomName?: string,
    roomProfileInfo: ProfileInfo, // TODO
    joinRule: JoinRule,
    historyVisibility: sdk.HistoryVisibility,
    powerLevels: sdk.IPowerLevelsContent,
    problems: MigratorError[],
}

interface UnavailableRoom {
    roomId: string,
    reason: MigratorError,
}

type GenericAccountData = { [key: string]: object };

interface Account {
    profileInfo: ProfileInfo,

    directMessages: GenericAccountData,
    ignoredUsers:   GenericAccountData,
    pushRules:      sdk.IPushRules,

    rooms: Set<Room>,
}

type Room = MigratableRoom | UnavailableRoom;

export function canBeMigrated(room: Room): room is MigratableRoom {
    return !('reason' in room);
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

    const joinRule = JoinRule.fromContent(getStateEvent(state, 'm.room.join_rules'));
    const historyVisibility = HistoryVisibility.fromContent(getStateEvent(state, 'm.room.history_visibility'));

    const powerLevels = getStateEvent(state, 'm.room.power_levels').content as sdk.IPowerLevelsContent;

    return {
        roomId,
        roomName,
        roomProfileInfo: {},
        joinRule,
        historyVisibility,
        powerLevels,
        problems: [],
    };
}

export async function collectRooms(client: sdk.MatrixClient): Promise<Set<Room>> {
    const joinedRooms = (await client.getJoinedRooms()).joined_rooms;
    let collected = 0;
    const reportProgress = () => {
        process.stderr.write('\r');
        if (++collected < joinedRooms.length) {
            process.stderr.write(`Collected ${collected}/${joinedRooms.length} rooms...`);
        }
    }

    const sem = new Semaphore(10);
    return new Set(await Promise.all(joinedRooms.map(async roomId => {
        await sem.acquire();
        const room = await collectRoom(client, roomId).catch(reason => {
            return {
                roomId,
                reason,
            };
        });
        sem.release();
        reportProgress();
        return room;
    })));
}

export async function collectAccount(client: sdk.MatrixClient): Promise<Account> {
    const directMessages = await client.getAccountDataFromServer('m.direct') ?? {};
    const ignoredUsers   = await client.getAccountDataFromServer('m.ignored_user_list') ?? {};
    const pushRules      = await client.getPushRules();

    const profileInfo = await client.getProfileInfo(client.getUserId()!);

    const rooms = await collectRooms(client);

    return {
        profileInfo,
        rooms,
        directMessages,
        ignoredUsers,
        pushRules,
    };
}

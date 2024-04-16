import * as sdk from "matrix-js-sdk";
import Semaphore from "@chriscdn/promise-semaphore";

import { HistoryVisibility, IncompleteStateError, JoinRule } from "./sdk-helpers";
import { MigratorError } from "./errors";

interface MigratableRoom {
    roomId: string,
    roomName?: string,
    roomDisplayName?: string, // TODO
    roomAvatarUrl?: string, // TODO
    joinRule: JoinRule,
    historyVisibility: sdk.HistoryVisibility,
    problems: MigratorError[],
}

interface UnavailableRoom {
    roomId: string,
    reason: MigratorError,
}

interface Account {
    profileInfo: {
        displayname?: string,
        avatar_url?: string,
    },
    directMessages: { [mxid: string]: string[] },
    rooms: Set<Room>,
}
type Room = MigratableRoom | UnavailableRoom;

export function canBeMigrated(room: Room): room is MigratableRoom {
    return !('fatalProblems' in room);
}

function getStateEvent(state: sdk.IStateEvent[], type: string): sdk.IContent {
    const eventContent = state.find(ev => ev.type === type)
    if (!eventContent) throw new IncompleteStateError(type);
    return eventContent;
}

async function collectRoom(client: sdk.MatrixClient, roomId: string): Promise<MigratableRoom> {
    const problems = [];
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

    if (historyVisibility === sdk.HistoryVisibility.Invited || historyVisibility === sdk.HistoryVisibility.Joined) {
        problems.push(new MigratorError(
            "Message history will be lost due to room settings",
            `m.room.history_visibility is set to ${historyVisibility}`,
        ));
    }

    return {
        roomId,
        roomName,
        joinRule,
        historyVisibility,
        problems,
    };
}

export async function collectRooms(client: sdk.MatrixClient): Promise<Set<Room>> {
    const joinedRooms = (await client.getJoinedRooms()).joined_rooms;//.slice(0, 10);
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
        const roomFacts = await collectRoom(client, roomId).catch(reason => {
            return {
                roomId,
                reason,
            };
        });
        sem.release();
        reportProgress();
        return roomFacts;
    })));
}

export async function collectAccount(client: sdk.MatrixClient): Promise<Account> {
    const directMessages = await client.getAccountDataFromServer('m.direct') ?? {};
    const profileInfo = await client.getProfileInfo(client.getUserId()!);
    return {
        profileInfo,
        rooms: await collectRooms(client),
        directMessages,
    };
}

import * as sdk from "matrix-js-sdk";

import { MigratableRoom, UnavailableRoom } from "./collector";
import { HistoryLossError, MigratorError, PowerLevelUnobtainableError, RoomNotJoinableError } from "./errors";
import { JoinRule } from "./sdk-helpers";

// modifies `rooms`, returns rooms with fatal problems
// XXX this API is a bit shit
export function checkForProblems(userId: string, rooms: Set<MigratableRoom>): Set<UnavailableRoom> {
    rooms.forEach(checkHistoryLoss);
    rooms.forEach(room => checkPLUnobtainable(userId, room));

    const joinableRooms = new Set<string>();
    const roomsToCheck = new Set(rooms);
    const unavailableRooms = new Set<UnavailableRoom>();

    const joinOrder = sortRooms(rooms);
    for (const room of joinOrder) {
        switch (room.joinRule) {
            case JoinRule.Invite: {
                const error = checkInviteUnavailable(userId, room);
                if (error) {
                    rooms.delete(room);
                    unavailableRooms.add({
                        roomId: room.roomId,
                        reason: error,
                    });
                } else {
                    joinableRooms.add(room.roomId);
                }
                roomsToCheck.delete(room);
                break;
            }
            case JoinRule.Restricted:
            case JoinRule.KnockRestricted:
                if (Array.from(room.requiredRooms ?? []).find(roomId => joinableRooms.has(roomId))) {
                    joinableRooms.add(room.roomId);
                    roomsToCheck.delete(room);
                }
                break;
            default:
                joinableRooms.add(room.roomId);
                roomsToCheck.delete(room);
        }
    }

    for (const room of roomsToCheck) {
        rooms.delete(room);
        unavailableRooms.add({
            roomId: room.roomId,
            reason: new RoomNotJoinableError("Cannot fullfill any room membership requirements"),
        });
    }

    return unavailableRooms;
}

function checkHistoryLoss(room: MigratableRoom) {
    if (room.historyVisibility === sdk.HistoryVisibility.Invited || room.historyVisibility === sdk.HistoryVisibility.Joined) {
        room.problems.push(new HistoryLossError(`m.room.history_visibility is set to ${room.historyVisibility}`));
    }
}

function checkInviteUnavailable(userId: string, room: MigratableRoom): MigratorError|undefined {
    const ourPL = room.powerLevels.users?.[userId] ?? room.powerLevels.users_default ?? 0;
    const requiredPL = room.powerLevels.invite ?? 0;
    if (requiredPL > ourPL) {
        return new RoomNotJoinableError(`Invite requires PL${requiredPL}, we have only ${ourPL}`);
    }
}

function checkPLUnobtainable(userId: string, room: MigratableRoom) {
    const ourPL = room.powerLevels.users?.[userId] ?? room.powerLevels.users_default ?? 0;
    if (ourPL === 0) return;

    const requiredPL = room.powerLevels.events?.["m.room.power_levels"] ?? room.powerLevels.state_default ?? 50;
    if (requiredPL > ourPL) {
        room.problems.push(new PowerLevelUnobtainableError(`Setting power levels requires PL${requiredPL}, we only have ${ourPL}`));
    }
}

enum Colour { NotYetChecked, Checked };
// Performs a best-effort topolopical sort of the rooms, to determine which one should be joined before others.
// This well help us with joinining restricted rooms, by outputting the dependencies before the dependents
// By itself won't notice cycles or rooms that are impossible to join - that's checkForProblems() job and it has a loop for that.
export function sortRooms(roomSet: Set<MigratableRoom>): MigratableRoom[] {
    const rooms = new Map<string, { room: MigratableRoom, deps: string[] }>();
    for (const room of roomSet) {
        const deps = [];
        if (room.joinRule === JoinRule.Restricted || room.joinRule === JoinRule.KnockRestricted) {
            deps.push(...Array.from(room.requiredRooms ?? []));
        }
        rooms.set(room.roomId, { room, deps });
    }

    const roomOrder: MigratableRoom[] = [];
    const colours: { [roomId: string]: Colour } = {};
    for (const room of roomSet) {
        colours[room.roomId] = Colour.NotYetChecked;
    }

    // DFS the dependency graph. We skip unknown rooms here.
    const visit = (roomId: string) => {
        if (colours[roomId] !== Colour.NotYetChecked) return;
        colours[roomId] = Colour.Checked;

        // It's now guaranteed to be an entry in `rooms` (otherwise it wouldn't be NotYetChecked),
        // so the ! assertions are safe
        rooms.get(roomId)!.deps.forEach(visit);
        roomOrder.push(rooms.get(roomId)!.room);
    };
    roomSet.forEach(room => visit(room.roomId));

    return roomOrder;
}

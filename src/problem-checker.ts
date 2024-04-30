import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "./collector";
import { HistoryLossError, PowerLevelUnobtainableError, RoomNotJoinableError } from "./errors";
import { JoinRule } from "./sdk-helpers";

export function checkForProblems(userId: string, rooms: Set<MigratableRoom>) {
    rooms.forEach(checkHistoryLoss);
    rooms.forEach(room => checkPLUnobtainable(userId, room));

    const joinableRooms = new Set<string>();
    const roomsToCheck = new Set(rooms);

    // So this is a bit ass.
    // We have public rooms that can be joined with no issues, and we have private rooms that cannot be joined: that part is easy.
    // But we also have restricted rooms, which can only be joined if other rooms are joinable.
    // Theoretically these can also be circular, so we can't just topo-sort this.
    // So what we do instead is we keep checking the rooms, updating `joinableRooms` as we learn about them,
    // until no changes are being made, meaning that no resolution is available for the remaining restricted rooms.
    let previouslyJoinableRooms: number
    do {
        previouslyJoinableRooms = joinableRooms.size;
        for (const room of Array.from(roomsToCheck)) {
            switch (room.joinRule) {
                case JoinRule.Invite:
                    if (!checkInviteUnavailable(userId, room)) {
                        joinableRooms.add(room.roomId);
                    }
                    roomsToCheck.delete(room);
                    break;
                case JoinRule.Restricted:
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
    } while (roomsToCheck.size > 0 && previouslyJoinableRooms != joinableRooms.size);
    for (const room of roomsToCheck) {
        room.problems.push(new RoomNotJoinableError("Cannot fullfill any room membership requirements"));
    }
}

function checkHistoryLoss(room: MigratableRoom) {
    if (room.historyVisibility === sdk.HistoryVisibility.Invited || room.historyVisibility === sdk.HistoryVisibility.Joined) {
        room.problems.push(new HistoryLossError(`m.room.history_visibility is set to ${room.historyVisibility}`));
    }
}

function checkInviteUnavailable(userId: string, room: MigratableRoom): boolean {
    const ourPL = room.powerLevels.users?.[userId] ?? room.powerLevels.users_default ?? 0;
    const requiredPL = room.powerLevels.invite ?? 0;
    if (requiredPL > ourPL) {
        room.problems.push(new RoomNotJoinableError(`Invite requires PL${requiredPL}, we have only ${ourPL}`));
        return true;
    }

    return false;
}

function checkPLUnobtainable(userId: string, room: MigratableRoom) {
    const ourPL = room.powerLevels.users?.[userId] ?? room.powerLevels.users_default ?? 0;
    if (ourPL === 0) return;

    const requiredPL = room.powerLevels.events?.["m.room.power_levels"] ?? room.powerLevels.state_default ?? 50;
    if (requiredPL > ourPL) {
        room.problems.push(new PowerLevelUnobtainableError(`Setting power levels requires PL${requiredPL}, we only have ${ourPL}`));
    }
}

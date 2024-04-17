import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "./collector";
import { JoinRule } from "./sdk-helpers";
import { HistoryLossError, RoomNotJoinableError } from "./errors";
import { checkForProblems } from "./problem-checker";

function mockRoom(overrides = {}) {
    const roomTemplate: MigratableRoom = {
        roomId: '!room:server',
        roomProfileInfo: {},
        joinRule: JoinRule.Public,
        historyVisibility: sdk.HistoryVisibility.WorldReadable,
        powerLevels: {},
        problems: [],
    };

    return {
        ...roomTemplate,
        problems: [],
        ...overrides,
    }
}

describe('problem-checker', () => {
    const userId = '@me:server';

    test('ordinary room causes no issues', () => {
        const room = mockRoom();
        checkForProblems(userId, new Set([room]));
        expect(room.problems.length).toBe(0);
    });

    test('detects problems with history visibility', () => {
        const badVisibilties = [sdk.HistoryVisibility.Invited, sdk.HistoryVisibility.Joined];
        for (const historyVisibility of badVisibilties) {
            const room = mockRoom({ historyVisibility });

            checkForProblems(userId, new Set([room]));
            expect(room.problems).toHaveLength(1);
            expect(room.problems[0]).toBeInstanceOf(HistoryLossError);
        }
    });

    test('detects problems with joining invite-only rooms', () => {
        const room = mockRoom({ joinRule: JoinRule.Invite }); 
        const rooms = new Set([room]);
        checkForProblems(userId, rooms)
        expect(room.problems).toHaveLength(0);

        room.powerLevels.invite = 50;
        checkForProblems(userId, rooms);
        expect(room.problems).toHaveLength(1);
        expect(room.problems[0]).toBeInstanceOf(RoomNotJoinableError);

        room.problems = [];
        room.powerLevels.users = { [userId]: 50 };
        checkForProblems(userId, rooms);
        expect(room.problems).toHaveLength(0);
    });

    test('sees a problem with a restricted room with no prerequisites met', () => {
        // by spec an empty set here means effectively a private room
        const room = mockRoom({ joinRule: JoinRule.Restricted, requiredRooms: new Set() }); 
        const rooms = new Set([room]);

        checkForProblems(userId, rooms)
        expect(room.problems).toHaveLength(1);
        expect(room.problems[0]).toBeInstanceOf(RoomNotJoinableError);

        room.problems = [];
        room.requiredRooms!.add('!room:server');
        checkForProblems(userId, rooms)
        expect(room.problems).toHaveLength(1);
        expect(room.problems[0]).toBeInstanceOf(RoomNotJoinableError);
    });

    test('can determine a restricted room as joinable', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server' }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
            mockRoom({ roomId: '!room3:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
        ]);

        checkForProblems(userId, rooms)
        for (const room of rooms) {
            expect(room.problems).toHaveLength(0);
        }
    });

    test('should gracefully handle circular room requirements', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
        ]);

        checkForProblems(userId, rooms)

        for (const room of rooms) {
            expect(room.problems).toHaveLength(1);
            expect(room.problems[0]).toBeInstanceOf(RoomNotJoinableError);
        }
    });
});

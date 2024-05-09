import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "./collector";
import { JoinRule } from "./sdk-helpers";
import { HistoryLossError, RoomNotJoinableError } from "./errors";
import { checkForProblems, sortRooms } from "./problem-checker";

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
        const [ok] = checkForProblems(userId, new Set([room]));
        expect(ok.size).toBe(1);
        expect(Array.from(ok)[0].problems.length).toBe(0);
    });

    test('detects problems with history visibility', () => {
        const badVisibilties = [sdk.HistoryVisibility.Invited, sdk.HistoryVisibility.Joined];
        for (const historyVisibility of badVisibilties) {
            const room = mockRoom({ historyVisibility });

            const [ok] = checkForProblems(userId, new Set([room]));
            const checkedRoom = Array.from(ok)[0];
            expect(room.problems).toHaveLength(0); // we don't want to mutate original object
            expect(checkedRoom.problems).toHaveLength(1);
            expect(checkedRoom.problems[0]).toBeInstanceOf(HistoryLossError);
        }
    });

    test('detects problems with joining invite-only rooms', () => {
        const room = mockRoom({ joinRule: JoinRule.Invite }); 
        const rooms = new Set([room]);
        checkForProblems(userId, rooms);
        expect(room.problems).toHaveLength(0);

        room.powerLevels.invite = 50;
        const [, unavailableRooms] = checkForProblems(userId, rooms);
        expect(unavailableRooms.size).toBe(1);
        expect(Array.from(unavailableRooms)[0].reason).toBeInstanceOf(RoomNotJoinableError);

        room.problems = [];
        room.powerLevels.users = { [userId]: 50 };
        checkForProblems(userId, rooms);
        expect(room.problems).toHaveLength(0);
    });

    test('sees a problem with a restricted room with no prerequisites met', () => {
        // by spec an empty set here means effectively a private room
        const room = mockRoom({ joinRule: JoinRule.Restricted, requiredRooms: new Set() }); 
        const rooms = new Set([room]);

        const [, unavailableRooms] = checkForProblems(userId, rooms);
        expect(unavailableRooms.size).toBe(1);
        expect(Array.from(unavailableRooms)[0].reason).toBeInstanceOf(RoomNotJoinableError);

        room.requiredRooms!.add('!room:server');
        checkForProblems(userId, rooms);
        expect(unavailableRooms.size).toBe(1);
        expect(Array.from(unavailableRooms)[0].reason).toBeInstanceOf(RoomNotJoinableError);
    });

    test('can determine a restricted room as joinable', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server' }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
            mockRoom({ roomId: '!room3:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
        ]);

        const [ok, nok] = checkForProblems(userId, rooms)
        expect(ok.size).toBe(3);
        expect(nok.size).toBe(0);
    });

    test('notices when a room is not joinable because we are planning to skip a prerequisite', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server' }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
        ]);

        const [ok, nok] = checkForProblems(userId, rooms, (room) => room.roomId.startsWith('!room1'));
        expect(ok.size).toBe(1);
        expect(Array.from(ok)[0].roomId).toBe('!room1:server');
        expect(nok.size).toBe(1);
        expect(Array.from(nok)[0].roomId).toBe('!room2:server');
    });

    test('should gracefully handle circular room requirements', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
        ]);

        const [ok, nok] = checkForProblems(userId, rooms)

        expect(ok.size).toBe(0);
        expect(nok.size).toBe(2);
        for (const room of nok) {
            expect(room.reason).toBeInstanceOf(RoomNotJoinableError);
        }
    });
});

describe('sortRooms()', () => {
    test('can topo-sort rooms to determine the join order', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room3:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
            mockRoom({ roomId: '!room1:server' }),
        ]);
        const order = sortRooms(rooms);
        expect(order.map(room => room.roomId)).toEqual(['!room1:server', '!room2:server', '!room3:server']);
    });

    test('does not break with circular dependencies', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room1:server']) }),
        ]);
        expect(() => sortRooms(rooms)).not.toThrow();
        // no infinite loop or exception is fine, order doesn't matter since dependencies cannot be met
    });

    test('does not break with unknown dependencies', () => {
        const rooms = new Set([
            mockRoom({ roomId: '!room1:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room2:server']) }),
            mockRoom({ roomId: '!room2:server', joinRule: JoinRule.Restricted, requiredRooms: new Set(['!room17:server']) }),
        ]);
        const order = sortRooms(rooms);
        // won't work, but is a good order of attempts
        expect(order.map(room => room.roomId)).toEqual(['!room2:server', '!room1:server']);
    });
});

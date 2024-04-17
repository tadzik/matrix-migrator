import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "./collector";
import { JoinRule } from "./sdk-helpers";
import { HistoryLossError } from "./errors";
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

const mockClient = {
    getUserId: () => '@me:server',
} as sdk.MatrixClient;

describe('collector', () => {
    test('ordinary room causes no issues', () => {
        const room = mockRoom();
        checkForProblems(mockClient, room);
        expect(room.problems.length).toBe(0);
    });

    test('detects problems with history visibility', () => {
        const badVisibilties = [sdk.HistoryVisibility.Invited, sdk.HistoryVisibility.Joined];
        for (const historyVisibility of badVisibilties) {
            const room = mockRoom({ historyVisibility });

            checkForProblems(mockClient, room);
            expect(room.problems).toHaveLength(1);
            expect(room.problems[0]).toBeInstanceOf(HistoryLossError);
        }
    });

    test('detects problems with joining invite-only rooms', () => {
        const room = mockRoom({ joinRule: JoinRule.Invite }); 
        checkForProblems(mockClient, room)
        expect(room.problems).toHaveLength(0);

        room.powerLevels.invite = 50;
        checkForProblems(mockClient, room);
        expect(room.problems).toHaveLength(1);

        room.problems = [];
        room.powerLevels.users = { [mockClient.getUserId()!]: 50 };
        checkForProblems(mockClient, room);
        expect(room.problems).toHaveLength(0);
    });
});

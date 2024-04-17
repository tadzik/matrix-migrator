import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "./collector";
import { HistoryLossError, MigratorError } from "./errors";
import { JoinRule } from "./sdk-helpers";

export function checkForProblems(client: sdk.MatrixClient, room: MigratableRoom) {
    if (room.historyVisibility === sdk.HistoryVisibility.Invited || room.historyVisibility === sdk.HistoryVisibility.Joined) {
        room.problems.push(new HistoryLossError(`m.room.history_visibility is set to ${room.historyVisibility}`));
    }

    if (room.joinRule === JoinRule.Invite) {
        const ourPL = room.powerLevels.users?.[client.getUserId() ?? ''] || room.powerLevels.users_default || 0;
        const requiredPL = room.powerLevels.invite ?? 0;
        if (requiredPL > ourPL) {
            room.problems.push(new MigratorError(
                "New account will not be able to join room: insufficient permissions",
                `Invite requires PL${requiredPL}, we have only ${ourPL}`,
            ));
        }
    }
}

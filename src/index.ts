import chalk from "chalk";
import loglevel from "loglevel";
import * as sdk from "matrix-js-sdk";
import { logger as sdkLogger } from 'matrix-js-sdk/lib/logger';
import { canBeMigrated, collectAccount } from "./collector";


const baseUrl = process.env['MATRIX_MIGRATOR_SOURCE_BASE_URL']!;
const userId = process.env['MATRIX_MIGRATOR_SOURCE_MXID']!;
const accessToken = process.env['MATRIX_MIGRATOR_SOURCE_ACCESS_TOKEN']!;

async function main() {
    sdkLogger.setLevel(loglevel.levels.INFO);

    const client = sdk.createClient({
        baseUrl,
        userId,
        accessToken,
    });

    const account = await collectAccount(client);
    
    console.log('Profile info:', account.profileInfo);
    console.log('Ignored users:', account.ignoredUsers);
    console.log(`Rooms available for migraton:`);
    for (const room of account.rooms) {
        if (canBeMigrated(room)) {
            console.log(' - ' + room.roomName ? `${room.roomName} (${room.roomId})` : room.roomId);
            if (room.problems.length > 0) {
                console.log(chalk.bold.yellow('\tIssues:'));
                for (const problem of room.problems) {
                    console.log(chalk.bold.yellow(`\t - ${problem.message}`));
                }
            }
        } else {
            console.warn(chalk.bold.red(` - Room ${room.roomId} cannot be migrated: ${room.reason}`));
        }
    }
}

main().then(
    () => process.exit(0)
).catch(err => {
    console.error(err);
    process.exit(1);
});

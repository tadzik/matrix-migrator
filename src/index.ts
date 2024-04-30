import chalk from "chalk";
import loglevel from "loglevel";
import * as sdk from "matrix-js-sdk";
import { logger as sdkLogger } from 'matrix-js-sdk/lib/logger';
import { collectAccount } from "./collector";
import { migrateAccount } from "./migrator";
import { checkForProblems } from "./problem-checker";


const baseUrl = process.env['MATRIX_MIGRATOR_SOURCE_BASE_URL']!;
const userId = process.env['MATRIX_MIGRATOR_SOURCE_MXID']!;
const accessToken = process.env['MATRIX_MIGRATOR_SOURCE_ACCESS_TOKEN']!;

async function main() {
    sdkLogger.setLevel(loglevel.levels.INFO);

    const migrationSource = sdk.createClient({
        baseUrl,
        userId,
        accessToken,
    });

    const migrationTarget = sdk.createClient({
        baseUrl,
        userId: '@migrationtarget1:home.tadzik.net',
        accessToken: 'syt_bWlncmF0aW9udGFyZ2V0MQ_DObHgWNBdoAIphNKqkHQ_1UFRFw'
    });


    const account = await collectAccount(migrationSource);
    
    console.log('Profile info:', account.profileInfo);
    console.log('Ignored users:', account.ignoredUsers);
    console.log('Direct messages:', account.directMessages);
    // console.log('Push rules:', JSON.stringify(account.pushRules, undefined, 2));
    console.log('Secret storage:', account.secretStorage);

    checkForProblems(migrationSource.getUserId()!, account.migratableRooms);

    console.log(`Rooms available for migraton:`);
    for (const room of account.migratableRooms) {
        console.log(' - ' + room.roomName ? `${room.roomName} (${room.roomId})` : room.roomId);
        if (room.problems.length > 0) {
            console.log(chalk.bold.yellow('\tIssues:'));
            for (const problem of room.problems) {
                console.log(chalk.bold.yellow(`\t - ${problem.message}`));
            }
        }
    }
    for (const room of account.unavailableRooms) {
        console.warn(chalk.bold.red(` - Room ${room.roomId} cannot be migrated: ${room.reason}`));
    }

    console.log(`Total rooms available for migration: ${account.migratableRooms.size}`);

    await migrateAccount(migrationSource, migrationTarget, account, {
        migrateProfile: true,
    });
}

main().then(
    () => process.exit(0)
).catch(err => {
    console.error(err);
    process.exit(1);
});

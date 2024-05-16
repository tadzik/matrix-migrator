import chalk from "chalk";
import loglevel from "loglevel";
import * as sdk from "matrix-js-sdk";
import { logger as sdkLogger } from 'matrix-js-sdk/lib/logger';
import { collectAccount } from "./collector";
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

    const account = await collectAccount(migrationSource, (msg, count, total) => {
        const progress = count ? ` (${count}/${total ?? '?'})` : '';
        process.stderr.write('\r');
        process.stderr.write(msg + progress + '...');
    });
    process.stderr.write('\n');
    
    console.log('Profile info:', account.profileInfo);
    console.log('Ignored users:', account.ignoredUsers);
    console.log('Direct messages:', account.directMessages);
    // console.log('Push rules:', JSON.stringify(account.pushRules, undefined, 2));

    const [ok, nok] = checkForProblems(migrationSource.getUserId()!, account.migratableRooms);

    console.log(`Rooms available for migraton:`);
    for (const room of ok) {
        console.log(' - ' + room.roomName ? `${room.roomName} (${room.roomId})` : room.roomId);
        if (room.problems.length > 0) {
            console.log(chalk.bold.yellow('\tIssues:'));
            for (const problem of room.problems) {
                console.log(chalk.bold.yellow(`\t - ${problem.message}`));
            }
        }
    }
    for (const room of nok) {
        const name = room.roomName ? `${room.roomName} (${room.roomId})` : room.roomId;
        console.warn(chalk.bold.red(` - Room ${name} cannot be migrated: ${room.reason}`));
    }

    console.log(`Total rooms available for migration: ${account.migratableRooms.size}`);
}

main().then(
    () => process.exit(0)
).catch(err => {
    console.error(err);
    process.exit(1);
});

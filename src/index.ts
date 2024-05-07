import chalk from "chalk";
import loglevel from "loglevel";
import * as sdk from "matrix-js-sdk";
import { logger as sdkLogger } from 'matrix-js-sdk/lib/logger';
import { collectAccount } from "./collector";
import { migrateAccount } from "./migrator";
import { checkForProblems } from "./problem-checker";
import { CryptoCallbacks } from "matrix-js-sdk/lib/crypto-api";
import { SecretStorageKeyDescription } from "matrix-js-sdk/lib/secret-storage";


const baseUrl = process.env['MATRIX_MIGRATOR_SOURCE_BASE_URL']!;
const userId = process.env['MATRIX_MIGRATOR_SOURCE_MXID']!;
const accessToken = process.env['MATRIX_MIGRATOR_SOURCE_ACCESS_TOKEN']!;

function createCryptoCallbacks(): CryptoCallbacks {
    // Store the cached secret storage key and return it when `getSecretStorageKey` is called
    let cachedKey: { keyId: string; key: Uint8Array };
    const cacheSecretStorageKey = (keyId: string, keyInfo: SecretStorageKeyDescription, key: Uint8Array) => {
        cachedKey = {
            keyId,
            key,
        };
    };

    const getSecretStorageKey = () => Promise.resolve<[string, Uint8Array]|null>(cachedKey ? [cachedKey.keyId, cachedKey.key] : null);

    return {
        cacheSecretStorageKey,
        getSecretStorageKey,
    };
}

async function main() {
    // sdkLogger.setLevel(loglevel.levels.INFO);

    const migrationSource = sdk.createClient({
        baseUrl,
        userId,
        accessToken,
        deviceId: 'MIGRATORID',
        cryptoCallbacks: createCryptoCallbacks(),
    });

    const migrationTarget = sdk.createClient({
        baseUrl,
        userId: process.env['MATRIX_MIGRATOR_TARGET_MXID']!,
        accessToken: process.env['MATRIX_MIGRATOR_TARGET_ACCESS_TOKEN']!,
    });


    const account = await collectAccount(migrationSource);
    
    console.log('Profile info:', account.profileInfo);
    console.log('Ignored users:', account.ignoredUsers);
    console.log('Direct messages:', account.directMessages);
    // console.log('Room keys:', JSON.stringify(account.keyBackup?.roomKeys, undefined, 2));
    // console.log('Push rules:', JSON.stringify(account.pushRules, undefined, 2));

    for (const unavailableRoom of checkForProblems(migrationSource.getUserId()!, account.migratableRooms)) {
        account.unavailableRooms.add(unavailableRoom);
    }

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

    for (const problem of account.problems) {
        console.warn(chalk.bold.red(`${problem.displayMessage}: ${problem.technicalDetails}`));
    }

    // await migrateAccount(migrationSource, migrationTarget, account, {
    //     migrateProfile: true,
    // });
}

main().then(
    () => process.exit(0)
).catch(err => {
    console.error(err);
    process.exit(1);
});

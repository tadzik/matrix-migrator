import * as sdk from "matrix-js-sdk";
import loglevel from "loglevel";
import { logger as sdkLogger } from 'matrix-js-sdk/lib/logger';

import { createHmac } from "crypto";

import { Account, collectAccount } from "./collector";
import { checkForProblems } from "./problem-checker";
import { migrateAccount } from "./migrator";

const sourceBaseUrlVar      = 'MATRIX_MIGRATOR_INTEGRATION_TEST_SOURCE_BASE_URL';
const sourceSharedSecretVar = 'MATRIX_MIGRATOR_INTEGRATION_TEST_SOURCE_SHARED_SECRET';
const targetBaseUrlVar      = 'MATRIX_MIGRATOR_INTEGRATION_TEST_TARGET_BASE_URL';
const targetSharedSecretVar = 'MATRIX_MIGRATOR_INTEGRATION_TEST_TARGET_SHARED_SECRET';

const sourceServerUrl = process.env[sourceBaseUrlVar];
const targetServerUrl = process.env[targetBaseUrlVar] ?? sourceServerUrl;
const sourceSharedSecret = process.env[sourceSharedSecretVar];
const targetSharedSecret = process.env[targetSharedSecretVar] ?? sourceSharedSecret

interface User {
    user_id: string,
    home_server: string,
    access_token: string,
    device_id: string,
}

async function registerUser(serverUrl: string, sharedSecret: string, username: string): Promise<User> {
    const sourceClient = sdk.createClient({
        baseUrl: serverUrl,
    });

    const nonce = await sourceClient.http.request<any>(sdk.Method.Get, '/_synapse/admin/v1/register', {}, undefined, { prefix: '' });

    const params = {
        nonce: nonce.nonce,
        username: username,
        password: 'testpassword',
        mac: '', 
    };
    params.mac = createHmac('sha1', sharedSecret)
        .update(params.nonce).update('\x00')
        .update(params.username).update('\x00')
        .update(params.password).update('\x00')
        .update('notadmin').digest('hex');

    return await sourceClient.http.request(sdk.Method.Post, '/_synapse/admin/v1/register', {}, params, { prefix: '' });
}

describe('integration', () => {
    sdkLogger.setLevel(loglevel.levels.SILENT);

    if (!sourceServerUrl) {
        console.log(`${sourceBaseUrlVar} not specified, skipping integration tests`);
        test('skipped', () => {});
        return;
    }

    let source: sdk.MatrixClient, target: sdk.MatrixClient;

    beforeEach(async () => {
        const sourceUser = await registerUser(sourceServerUrl, sourceSharedSecret!, `integration-test-source-${Date.now()}`);
        const targetUser = await registerUser(targetServerUrl!, targetSharedSecret!, `integration-test-target-${Date.now()}`);
        console.debug(`Will migrate ${sourceUser.user_id} to ${targetUser.user_id}`);
        // console.debug(sourceUser);
        // console.debug(targetUser);
        source = sdk.createClient({
            baseUrl: sourceServerUrl,
            userId: sourceUser.user_id,
            accessToken: sourceUser.access_token,
            deviceId: sourceUser.device_id,
        });
        target = sdk.createClient({
            baseUrl: targetServerUrl!,
            userId: targetUser.user_id,
            accessToken: targetUser.access_token,
            deviceId: targetUser.device_id,
        });
    });    

    test('can migrate public room membership', async () => {
        const room = await source.createRoom({ preset: sdk.Preset.PublicChat });

        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(1);
        const collectedRoom = Array.from(account.migratableRooms)[0];
        expect(collectedRoom.roomId).toBe(room.room_id);

        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);

        await migrateAccount(source, target, account, { migrateProfile: true });

        const joinedRooms = await target.getJoinedRooms();
        expect(joinedRooms.joined_rooms.length).toBe(1);
        expect(joinedRooms.joined_rooms[0]).toBe(room.room_id);
    });
});

function assertNoProblems(account: Account) {
    for (const room of account.migratableRooms) {
        expect(room.problems).toEqual([]);
    }
    expect(account.unavailableRooms.size).toBe(0);
}


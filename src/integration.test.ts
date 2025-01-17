import * as sdk from "matrix-js-sdk";
import loglevel from "loglevel";
import { logger as sdkLogger } from 'matrix-js-sdk/lib/logger';
import TypedEmitter from "typed-emitter"

import { createHmac } from "crypto";

import { Account, DirectMessages, collectAccount } from "./collector";
import { checkForProblems, sortRooms } from "./problem-checker";
import { MigrationEvents, Status, migrateAccount } from "./migrator";
import { HistoryLossError, PowerLevelUnobtainableError, RoomTombstonedError } from "./errors";

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

const noopOptions = {
    leaveMigratedRooms: false,
    migrateProfile: false,
    addOldMxidNotification: false,
    renameOldAccount: null,
};

async function registerUser(serverUrl: string, sharedSecret: string, username: string): Promise<User> {
    const sourceClient = sdk.createClient({
        baseUrl: serverUrl,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line jest/expect-expect
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

    async function migrationFinished(
        events: TypedEmitter<MigrationEvents>,
        expect: (okRooms: Set<string>, badRooms: Map<string, Error>) => void,
    ) {
        return new Promise<void>((resolve, reject) => {
            const okRooms = new Set<string>();
            const badRooms = new Map<string, Error>();
            events.on('room', (roomId, status, err) => {
                if (status === Status.InProgress) return;

                if (status === Status.Finished) {
                    okRooms.add(roomId);
                } else {
                    badRooms.set(roomId, err!);
                }
            });
            events.on('accountData', (_status, err) => {
                if (err) reject(err);
            });
            events.on('profile', (_status, err) => {
                if (err) reject(err);
            });
            events.on('finished', () => {
                expect(okRooms, badRooms);
                resolve();
            });
        });
    }

    test('can migrate public room membership', async () => {
        const room = await source.createRoom({ preset: sdk.Preset.PublicChat });

        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(1);
        const collectedRoom = Array.from(account.migratableRooms)[0];
        expect(collectedRoom.roomId).toBe(room.room_id);

        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(1));

        const joinedRooms = await target.getJoinedRooms();
        expect(joinedRooms.joined_rooms.length).toBe(1);
        expect(joinedRooms.joined_rooms[0]).toBe(room.room_id);
    });

    test('can migrate invite-only room membership', async () => {
        const room = await source.createRoom({ preset: sdk.Preset.PrivateChat });

        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(1);
        const collectedRoom = Array.from(account.migratableRooms)[0];
        expect(collectedRoom.roomId).toBe(room.room_id);

        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(1));

        const joinedRooms = await target.getJoinedRooms();
        expect(joinedRooms.joined_rooms.length).toBe(1);
        expect(joinedRooms.joined_rooms[0]).toBe(room.room_id);

        const powerLevels = await target.getStateEvent(room.room_id, 'm.room.power_levels', '');
        expect(powerLevels.users[target.getUserId()!]).toEqual(powerLevels.users[source.getUserId()!]);

        // should not die
        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(1));
    });

    test('can restricted room membership', async () => {
        const publicRoom = await source.createRoom({ preset: sdk.Preset.PublicChat });
        await source.createRoom({
            initial_state: [
                {
                    type: "m.room.join_rules",
                    content: { join_rule: 'restricted', allow: [
                        { type: 'm.room_membership', room_id: publicRoom.room_id }
                    ] }
                }
            ]
        });

        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(2);
        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(2));

        const joinedRooms = await target.getJoinedRooms();
        expect(joinedRooms.joined_rooms.length).toBe(2);
    });

    test('can migrate ignored users', async () => {
        await source.setIgnoredUsers(['@cat:server']);
        await target.setIgnoredUsers(['@dog:server']);

        const account = await collectAccount(source);
        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(0));

        // MatrixClient.getIgnoredUsers() is broken: https://github.com/matrix-org/matrix-js-sdk/issues/4176
        const ignoredUsers = await target.getAccountDataFromServer('m.ignored_user_list');
        expect(Object.keys(ignoredUsers!.ignored_users).length).toBe(2);
        expect('@cat:server' in ignoredUsers!.ignored_users).toBe(true);
        expect('@dog:server' in ignoredUsers!.ignored_users).toBe(true);
    });

    test('skips upgraded rooms', async () => {
        const room = await source.createRoom({ preset: sdk.Preset.PublicChat, room_version: '1' });
        const upgradedRoom = await source.upgradeRoom(room.room_id, '2');

        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(1);
        const collectedRoom = Array.from(account.migratableRooms)[0];
        expect(collectedRoom.roomId).toBe(upgradedRoom.replacement_room);

        checkForProblems(source.getUserId()!, account.migratableRooms);
        expect(account.unavailableRooms.size).toEqual(1);
        const unavailableRoom = Array.from(account.unavailableRooms)[0];
        expect(unavailableRoom.roomId).toEqual(room.room_id);
        expect(unavailableRoom.reason).toBeInstanceOf(RoomTombstonedError);

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(1));
        const joinedRooms = await target.getJoinedRooms();
        expect(joinedRooms.joined_rooms.length).toBe(1);
        expect(joinedRooms.joined_rooms[0]).toBe(upgradedRoom.replacement_room);
    });

    test('can migrate profile info', async () => {
        const displayName = `Testing! ${Date.now()}`;
        await source.setDisplayName(displayName);

        const emptyGif = Buffer.from("R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=", 'base64');
        const uploaded = await source.uploadContent(emptyGif);
        await source.setAvatarUrl(uploaded.content_uri);

        const account = await collectAccount(source);
        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: {
                ...noopOptions,
                migrateProfile: true,
            }
        }), expectRoomsMigrated(0));

        const profileInfo = await target.getProfileInfo(target.getUserId()!);
        expect(profileInfo.displayname).toEqual(displayName);
        expect(profileInfo.avatar_url).toEqual(uploaded.content_uri);
    });

    test('can leave rooms with the old account', async () => {
        const room = await source.createRoom({ preset: sdk.Preset.PublicChat });

        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(1);
        const collectedRoom = Array.from(account.migratableRooms)[0];
        expect(collectedRoom.roomId).toBe(room.room_id);

        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: {
                ...noopOptions,
                leaveMigratedRooms: true,
            },
        }), expectRoomsMigrated(1));

        const sourceJoinedRooms = await source.getJoinedRooms();
        expect(sourceJoinedRooms.joined_rooms.length).toBe(0);
    });

    test('can rename old account after the migration', async () => {
        const account = await collectAccount(source);
        expect(account.migratableRooms.size).toBe(0);

        const renameTo = 'Moved to a better place';

        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: [],
            options: {
                ...noopOptions,
                renameOldAccount: renameTo,
            },
        }), expectRoomsMigrated(0));

        const sourceProfile = await source.getProfileInfo(source.getUserId()!);
        expect(sourceProfile.displayname).toEqual(renameTo);
    });

    test("can add a notificaton for old account's MXID", async () => {
        const account = await collectAccount(source);
        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);
        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: {
                ...noopOptions,
                addOldMxidNotification: true,
            },
        }), expectRoomsMigrated(0));

        const sourcePushRules = await source.getPushRules();
        const targetPushRules = await target.getPushRules();
        expect(targetPushRules.global.content?.length).toBeGreaterThan(sourcePushRules.global.content?.length ?? 0);
        expect(targetPushRules.global.content!.some(r => r.pattern === source.getUserId()!)).toEqual(true);
    });

    test('migrates push rules', async () => {
        await source.setPushRuleEnabled('global', sdk.PushRuleKind.Override, '.m.rule.is_room_mention', false);
        await source.addPushRule('global', sdk.PushRuleKind.ContentSpecific, 'cookies', {
            actions: [ sdk.PushRuleActionName.Notify ],
            pattern: "cookies",
        });
        await source.addPushRule('global', sdk.PushRuleKind.ContentSpecific, 'disabledcookies', {
            actions: [ sdk.PushRuleActionName.Notify ],
            pattern: "cookies",
        });
        await source.setPushRuleEnabled('global', sdk.PushRuleKind.ContentSpecific, 'disabledcookies', false);

        const account = await collectAccount(source);
        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);
        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(0));

        const pushRules = await target.getPushRules();
        expect(pushRules.global.override!.find(r => r.rule_id === '.m.rule.is_room_mention')!.enabled).toEqual(false);
        expect(pushRules.global.content!.find(r => r.rule_id === 'cookies')!.enabled).toEqual(true);
        expect(pushRules.global.content!.find(r => r.rule_id === 'disabledcookies')!.enabled).toEqual(false);
    });

    test('only migrate the relevant subset of m.direct', async () => {
        const dmRoom = await source.createRoom({
            preset: sdk.Preset.PrivateChat,
        });
        await source.invite(dmRoom.room_id, target.getUserId()!);
        const dms: DirectMessages = {
            [target.getUserId()!]: [dmRoom.room_id],
        };
        await source.setAccountData('m.direct', dms);

        const account = await collectAccount(source);
        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);
        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: [],
            options: noopOptions,
        }), expectRoomsMigrated(0));

        const newDms = await target.getAccountDataFromServer('m.direct') ?? {};
        expect(newDms).toEqual({});
    });

    test('should not complain is target account is more powerful than source', async () => {
        const room = await source.createRoom({
            preset: sdk.Preset.PublicChat,
        });
        await target.joinRoom(room.room_id);
        await source.setPowerLevel(room.room_id, target.getUserId()!, 99);
        await source.setPowerLevel(room.room_id, source.getUserId()!, undefined);

        const account = await collectAccount(source);
        checkForProblems(source.getUserId()!, account.migratableRooms);
        assertNoProblems(account);
        await migrationFinished(migrateAccount(source, target, {
            ...account,
            rooms: sortRooms(account.migratableRooms),
            options: noopOptions,
        }), expectRoomsMigrated(1));
    });

    describe('complaints', () => {
        test('complains about losing history', async () => {
            const room = await source.createRoom({
                initial_state: [
                    { type: "m.room.history_visibility", content: { "history_visibility": "invited" } },
                ],
            });

            const account = await collectAccount(source);
            const [ok] = checkForProblems(source.getUserId()!, account.migratableRooms);

            expect(ok.size).toBe(1);
            const collectedRoom = Array.from(ok)[0];
            expect(collectedRoom.roomId).toBe(room.room_id);
            expect(collectedRoom.problems).toHaveLength(1);
            expect(collectedRoom.problems[0]).toBeInstanceOf(HistoryLossError);
        });

        test('complains if we cannot obtain the same PL', async () => {
            const roomCreatorUser = await registerUser(sourceServerUrl, sourceSharedSecret!, `integration-test-helper-${Date.now()}`);
            const roomCreator = sdk.createClient({
                baseUrl: sourceServerUrl,
                userId: roomCreatorUser.user_id,
                accessToken: roomCreatorUser.access_token,
                deviceId: roomCreatorUser.device_id,
            });

            const room = await roomCreator.createRoom({ preset: sdk.Preset.PrivateChat });
            await roomCreator.invite(room.room_id, source.getUserId()!);
            await source.joinRoom(room.room_id);
            await roomCreator.setPowerLevel(room.room_id, source.getUserId()!, 50);

            const account = await collectAccount(source);
            const [ok] = checkForProblems(source.getUserId()!, account.migratableRooms);
            expect(ok.size).toBe(1);
            const collectedRoom = Array.from(ok)[0];
            expect(collectedRoom.roomId).toBe(room.room_id);
            expect(collectedRoom.problems).toHaveLength(1);
            expect(collectedRoom.problems[0]).toBeInstanceOf(PowerLevelUnobtainableError);
        });
    });
});

function assertNoProblems(account: Account) {
    for (const room of account.migratableRooms) {
        expect(room.problems).toEqual([]);
    }
    expect(account.unavailableRooms.size).toBe(0);
}

function expectRoomsMigrated(count: number) {
    return (okRooms: Set<string>, badRooms: Map<string, Error>) => {
        expect(okRooms.size).toEqual(count);
        expect(badRooms.size).toEqual(0);
    }
}


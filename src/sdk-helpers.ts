import { InvalidStateError } from './errors';
import * as sdk from "matrix-js-sdk";

import { Curve25519AuthData, KeyBackupInfo } from "matrix-js-sdk/lib/crypto-api";
import { Curve25519, IKeyBackup } from "matrix-js-sdk/lib/crypto/backup";
import { IKeyBackupInfo } from "matrix-js-sdk/lib/crypto/keybackup";

import olm from "@matrix-org/olm";
global.Olm = olm;

// Custom built since sdk.JoinRule doesn't contain knock_restricted (as of v32.0.0)
export enum JoinRule {
    Public          = 'public',
    Private         = 'private',
    Invite          = 'invite',
    Restricted      = 'restricted',
    Knock           = 'knock',
    KnockRestricted = 'knock_restricted',
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JoinRule {
    export function fromContent(content: sdk.IContent): JoinRule {
        const value = content.content.join_rule;
        switch (value) {
            case 'public':           return JoinRule.Public;
            case 'private':          return JoinRule.Private;
            case 'invite':           return JoinRule.Invite;
            case 'restricted':       return JoinRule.Restricted;
            case 'knock':            return JoinRule.Knock;
            case 'knock_restricted': return JoinRule.KnockRestricted;
            case undefined:
                throw new InvalidStateError('m.room.join_rules', 'Event content does not contain the correct value');
            default:
                throw new InvalidStateError('m.room.join_rules', `'${value}' is not a valid join rule`);
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace HistoryVisibility {
    export function fromContent(content: sdk.IContent): sdk.HistoryVisibility {
        const value = content.content.history_visibility;
        switch (value) {
            case 'world_readable': return sdk.HistoryVisibility.WorldReadable;
            case 'shared':         return sdk.HistoryVisibility.Shared;
            case 'invited':        return sdk.HistoryVisibility.Invited;
            case 'joined':         return sdk.HistoryVisibility.Joined;
            case undefined:
                throw new InvalidStateError('m.room.history_visibility', 'Event content does not contain the correct value');
            default:
                throw new InvalidStateError('m.room.history_visibility', `'${value}' is not a valid history visibility`);
        }
    }
}

export async function patiently<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (err.errcode === 'M_LIMIT_EXCEEDED') {
            const timeout = err.data.retry_after_ms;
            console.debug(`Got rate limited, sleeping for the requested ${timeout/1000}s`);
            return new Promise(resolve => {
                setTimeout(() => patiently(fn).then(resolve), timeout);
            });
        } else {
            throw err;
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catchNotFound(err: any) {
    if (err.errcode === 'M_NOT_FOUND') {
        return undefined;
    }
    throw err;
}

import * as base64 from "base64-arraybuffer";
import * as crypto from "crypto";
import bs58 from "bs58";
import { SecretStorageKeyDescriptionCommon } from 'matrix-js-sdk/lib/secret-storage';

interface BackupPassphrase {
    type: 'passphrase';
    passphrase: string;
}

interface BackupKey {
    type: 'key';
    key: string;
}

export type KeyOrPassphrase = BackupKey | BackupPassphrase;

async function getKeyBitsFromKeyOrPassphrase(keyOrPassphrase: KeyOrPassphrase, keyDescription: SecretStorageKeyDescriptionCommon): Promise<Uint8Array> {
    if (keyOrPassphrase.type === 'passphrase') {
        const key = await crypto.subtle.importKey('raw', Buffer.from(keyOrPassphrase.passphrase), { name: 'PBKDF2' }, false, ['deriveBits']);
        const DEFAULT_ITERATIONS = 500000;
        const DEFAULT_BITSIZE = 256;
        return new Uint8Array(await crypto.subtle.deriveBits({
            name: 'PBKDF2',
            salt: Buffer.from(keyDescription.passphrase.salt),
            iterations: keyDescription.passphrase.iterations ?? DEFAULT_ITERATIONS,
            hash: 'SHA-512',
        }, key, keyDescription.passphrase.bits ?? DEFAULT_BITSIZE));
    } else {
        await olm.init();
        const OLM_RECOVERY_KEY_PREFIX = [0x8B, 0x01] as const;
        const byteString = bs58.decode(keyOrPassphrase.key.replace(/ /g, ''));

        let parity = 0;
        for (const b of byteString) {
            parity ^= b;
        }
        if (parity !== 0) {
            throw new Error("Incorrect key parity");
        }

        for (let i = 0; i < OLM_RECOVERY_KEY_PREFIX.length; ++i) {
            if (byteString[i] !== OLM_RECOVERY_KEY_PREFIX[i]) {
                throw new Error("Incorrect key prefix");
            }
        }

        if (
            byteString.length !==
            OLM_RECOVERY_KEY_PREFIX.length + olm.PRIVATE_KEY_LENGTH + 1
        ) {
            throw new Error("Incorrect key length");
        }

        return Uint8Array.from(byteString.slice(
            OLM_RECOVERY_KEY_PREFIX.length,
            OLM_RECOVERY_KEY_PREFIX.length + olm.PRIVATE_KEY_LENGTH,
        ));
    }
}

export async function getSecureBackupPrivateKey(client: sdk.MatrixClient, keyOrPassphrase: KeyOrPassphrase): Promise<Uint8Array> {
    // Thanks, hydrogen-web!

    const defaultKeyEvent = await client.getAccountDataFromServer('m.secret_storage.default_key');
    const keyId = defaultKeyEvent?.key;
    const keyDescription = await client.getAccountDataFromServer<SecretStorageKeyDescriptionCommon>(`m.secret_storage.key.${keyId}`);
    if (!keyDescription) throw new Error(`Key ${keyId} not found`);
    if (keyDescription.passphrase.algorithm !== 'm.pbkdf2') {
        throw new Error(`Unsupported password algorithm: '${keyDescription.algorithm}'`);
    }

    const keyBits = await getKeyBitsFromKeyOrPassphrase(keyOrPassphrase, keyDescription);

    // KeyBackup._decryptAccountData()
    const keyBackup = await client.getAccountDataFromServer('m.megolm_backup.v1');
    if (!keyBackup) throw new Error("No key backup :(");

    const encryptedData = keyBackup.encrypted[keyId];
    // SecretStorage._decryptAESSecret()
    const hkdfKey = await crypto.subtle.importKey(
        'raw',
        keyBits,
        { name: 'HKDF' },
        false,
        ['deriveBits']
    );
    const hkdfKeyBits = new Uint8Array(await crypto.subtle.deriveBits({
        name: 'HKDF',
        salt: new Uint8Array(8).buffer,
        info: Buffer.from('m.megolm_backup.v1'),
        hash: 'SHA-256',
    }, hkdfKey, 512));
    const aesKey = hkdfKeyBits.slice(0, 32);
    const cipherTextBytes = base64.decode(encryptedData.ciphertext);

    // TODO
    // const hmacKey = hkdfKeyBits.slice(32);
    // const isVerified = await hmacVerify(hmacKey, base64.decode(encryptedData.mac), cipherTextBytes, "SHA-256");

    const aesOpts = { name: "AES-CTR", counter: base64.decode(encryptedData.iv), length: 64 };
    const importedAesKey = await crypto.subtle.importKey(
        'raw',
        aesKey,
        aesOpts as any,
        false,
        ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(aesOpts, importedAesKey, cipherTextBytes);
    const b64PrivateKey = new Uint8Array(plaintext);
    const privateKey = new Uint8Array(base64.decode((new TextDecoder()).decode(b64PrivateKey)));

    return privateKey;
}

export async function exportRoomKeys(client: sdk.MatrixClient, keyOrPassphrase: KeyOrPassphrase): Promise<sdk.IMegolmSessionData[]> {
    const roomKeysVersion = await client.http.authedRequest<IKeyBackupInfo>(sdk.Method.Get, '/room_keys/version');
    if (!roomKeysVersion) {
        throw new Error("Key backup not set up");
    }

    if (roomKeysVersion.algorithm !== Curve25519.algorithmName) {
        throw new Error(`Unsupported key backup algorithm, ${roomKeysVersion.algorithm}, we can only deal with ${Curve25519.algorithmName}`);
    }

    const encryptedRoomKeys = await client.http.authedRequest<IKeyBackup>(sdk.Method.Get, `/room_keys/keys?version=${roomKeysVersion.version}`);

    const roomKeysKey = await getSecureBackupPrivateKey(client, keyOrPassphrase);

    await olm.init();
    const olmDecryption = new olm.PkDecryption();
    const olmPubKey = olmDecryption.init_with_private_key(roomKeysKey);
    if (olmPubKey !== (roomKeysVersion.auth_data as Curve25519AuthData).public_key) {
        throw new Error("Our decryption key doesn't match the key used to encrypt the key backup");
    }

    const roomKeys = [];
    for (const roomId of Object.keys(encryptedRoomKeys.rooms)) {
        for (const [sessionId, session] of Object.entries(encryptedRoomKeys.rooms[roomId].sessions)) {
            const sessionData = session.session_data;
            const sessionInfo = JSON.parse(olmDecryption.decrypt(sessionData.ephemeral, sessionData.mac, sessionData.ciphertext)) as {
                algorithm: string,
                sender_key: string,
                sender_claimed_keys: {[algorithm: string]: string},
                forwarding_curve25519_key_chain: string[],
                session_key: string
            };
            roomKeys.push({
                ...sessionInfo,
                session_id: sessionId,
                room_id: roomId,
            });
        }
    }
    return roomKeys;
}

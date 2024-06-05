import * as sdk from "matrix-js-sdk";

import { DirectMessages, IgnoredUserList, MigratableRoom, ProfileInfo } from "./collector";
import { JoinRule, catchNotFound, patiently } from "./sdk-helpers";
import { sleep } from "matrix-js-sdk/lib/utils";

import EventEmitter from "events"
import TypedEmitter from "typed-emitter"

export interface MigrationRequest {
    profileInfo?:   ProfileInfo,
    directMessages: DirectMessages,
    ignoredUsers:   IgnoredUserList,
    pushRules:      sdk.IPushRules,
    rooms:          MigratableRoom[],
}

async function joinByInvite(source: sdk.MatrixClient, target: sdk.MatrixClient, roomId: string) {
    const existingMembership = await source.getStateEvent(roomId, 'm.room.member', target.getUserId()!).then(ev => ev.membership).catch(catchNotFound);
    if (existingMembership === 'join') {
        console.debug(`Target is already in room ${roomId}`);
        return;
    }

    await patiently(async () => {
        console.debug(`Sending an invite for ${roomId}`);
        await source.invite(roomId, target.getUserId()!);
    });

    let lastError: unknown;
    const attempts = 5;
    for (let i = 0; i < attempts; i++) {
        try {
            await patiently(async () => {
                await target.joinRoom(roomId);
            });
            console.debug(`Successfully joined ${roomId} after an invite`);
            return;
        } catch (err) {
            lastError = err;
            console.debug(`Failed to join invite-only room ${roomId} (${err}), waiting a bit...`);
            await sleep((i + 1) * 1000);
        }
    }

    throw new Error(`Failed to join invite-only room ${roomId} after ${attempts} attempts: ${lastError}`);
}

/** Copy source's m.direct contents into target's.
 * This will merge the lists of DM rooms for each MXID, possibly resulting in multiple DMs per user.
 *
 * Exported for testing purposes, not intended to be used directly.
 */
export function mergeDirectMessages(sourceDMs: DirectMessages, targetDMs: DirectMessages, migratedRooms: Set<string>): DirectMessages {
    const dms: DirectMessages = JSON.parse(JSON.stringify(targetDMs));

    for (const key in sourceDMs) {
        const newDms = sourceDMs[key].filter(roomId => migratedRooms.has(roomId));
        if (newDms.length === 0) continue;
        if (!(key in dms)) {
            dms[key] = [];
        }
        // Remove duplicates. These makes migration safe to reapply
        dms[key] = Array.from(new Set([...dms[key], ...newDms]));
    }

    return dms;
}

/** Copy source's ignored users into target's list
 *
 * Exported for testing purposes, not intended to be used directly.
 */
export function mergeIgnoredUserLists(sourceIgnoredUsers: IgnoredUserList, targetIgnoredUsers: IgnoredUserList): IgnoredUserList {
    return {
        ignored_users: {
            ...sourceIgnoredUsers.ignored_users,
            ...targetIgnoredUsers.ignored_users,
        }
    };
}

async function migrateAccountData(account: MigrationRequest, target: sdk.MatrixClient) {
    const sourceDirectMessages = account.directMessages;
    const targetDirectMessages = await target.getAccountDataFromServer('m.direct') ?? {};
    await target.setAccountData('m.direct', mergeDirectMessages(sourceDirectMessages, targetDirectMessages, new Set(account.rooms.map(r => r.roomId))));

    const sourceIgnoredUsers = account.ignoredUsers;
    const targetIgnoredUsers = await target.getAccountDataFromServer('m.ignored_user_list') as IgnoredUserList ?? { ignored_users: {} };
    await target.setAccountData('m.ignored_user_list', mergeIgnoredUserLists(sourceIgnoredUsers, targetIgnoredUsers));

    for (const kind of ['content', 'override', 'room', 'sender', 'underride'] as sdk.PushRuleKind[]) {
        for (const rule of account.pushRules.global[kind] ?? []) {
            if (rule.default && !rule.enabled && rule.rule_id !== '.m.rule.master') {
                console.debug(`Disabling default push rule "${rule.rule_id}"`);
                await target.setPushRuleEnabled('global', kind, rule.rule_id, false);
            } else if (!rule.default) {
                console.debug(`Migrating push rule ${rule.rule_id}`);
                // Per spec, the rule MUST be enabled when it's being added.
                // It's safe to assume it's not there yet, since it's not a default.
                // Thus, we always add it as enabled and disable it later if needed.
                const ruleBody: any = { ...rule }; // eslint-disable-line @typescript-eslint/no-explicit-any
                delete ruleBody['enabled'];
                // This does a PUT under the hood, so it's safe to rerun if we're double-migrating
                await target.addPushRule('global', kind, rule.rule_id, ruleBody);
                if (!rule.enabled) {
                    await target.setPushRuleEnabled('global', kind, rule.rule_id, false);
                }
            }
        }
    }
}

async function migrateProfile(profileInfo: ProfileInfo, target: sdk.MatrixClient) {
    if (profileInfo.displayname) {
        await target.setDisplayName(profileInfo.displayname);
    }
    if (profileInfo.avatar_url) {
        const [, targetServerName] = target.getUserId()!.match(/^@[^:]+:(.+)$/)!;
        const [, sourceAvatarServerName] = profileInfo.avatar_url.match(/^mxc:\/\/([^/]+)/)!
        if (sourceAvatarServerName != targetServerName) {
            const httpUrl = target.mxcUrlToHttp(profileInfo.avatar_url)!;
            const resp = await fetch(httpUrl);
            const uploaded = await target.uploadContent(await resp.arrayBuffer());
            await target.setAvatarUrl(uploaded.content_uri);
        } else {
            await target.setAvatarUrl(profileInfo.avatar_url);
        }
    }
}

async function migratePowerLevel(source: sdk.MatrixClient, target: sdk.MatrixClient, room: MigratableRoom) {
    const sourcePL = room.powerLevels.users?.[source.getUserId()!] ?? room.powerLevels.users_default ?? 0;
    const currentPLs = await target.getStateEvent(room.roomId, 'm.room.power_levels', '') as sdk.IPowerLevelsContent;
    const currentTargetPL = currentPLs.users?.[target.getUserId()!] ?? room.powerLevels.users_default ?? 0;
    if (sourcePL !== currentTargetPL) {
        try {
        await source.setPowerLevel(room.roomId, target.getUserId()!, sourcePL);
        } catch (err) {
            throw new Error(`Failed to set power level to ${sourcePL}`);
        }
    }
}

export enum Status {
    InProgress = "In progress",
    Finished = "Finished",
    Error = "Error",
}

export type MigrationEvents = {
    message: (msg: string) => void,
    room: (roomId: string, status: Status, error?: Error) => void,
    accountData: (status: Status, error?: Error) => void,
    profile: (status: Status, error?: Error) => void,
    finished: () => void,
};

async function doMigrateAccount(source: sdk.MatrixClient, target: sdk.MatrixClient, request: MigrationRequest, events: TypedEmitter<MigrationEvents>) {
    for (const room of request.rooms) {
        events.emit('room', room.roomId, Status.InProgress);
        try {
            if (room.joinRule === JoinRule.Invite) {
                events.emit('message', `Inviting the new account to ${room.roomName ?? room.roomId}`);
                await joinByInvite(source, target, room.roomId);
            } else {
                events.emit('message', `Joining room ${room.roomName ?? room.roomId}`);
                await patiently(async () => {
                    await target.joinRoom(room.roomId);
                });
            }

            await migratePowerLevel(source, target, room);

            events.emit('room', room.roomId, Status.Finished);
        } catch (err) {
            console.error(`Failed to join room ${room.roomId} ${room.roomName ? `(${room.roomName}) ` : ''}: ${err}`);
            events.emit('room', room.roomId, Status.Error, err as Error);
        }
    }

    try {
        events.emit('message', `Migrating account data`);
        events.emit('accountData', Status.InProgress);
        await migrateAccountData(request, target);
        events.emit('accountData', Status.Finished);
    } catch (err) {
        events.emit('accountData', Status.Error, err as Error);
    }

    if (request.profileInfo) {
        try {
            events.emit('message', `Migrating profile`);
            events.emit('profile', Status.InProgress);
            await migrateProfile(request.profileInfo!, target);
            events.emit('profile', Status.Finished);
        } catch (err) {
            events.emit('profile', Status.Error, err as Error);
        }
    }

    events.emit('finished');
}

export function migrateAccount(
    source: sdk.MatrixClient,
    target: sdk.MatrixClient,
    request: MigrationRequest
): TypedEmitter<MigrationEvents> {
    const events = new EventEmitter() as TypedEmitter<MigrationEvents>;
    void doMigrateAccount(source, target, request, events);
    return events;
}

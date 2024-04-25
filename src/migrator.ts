import * as sdk from "matrix-js-sdk";

import { Account, DirectMessages, IgnoredUserList } from "./collector";
import { JoinRule } from "./sdk-helpers";

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function patiently<T>(fn: () => Promise<T>): Promise<T> {
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
function catchNotFound(err: any) {
    if (err.errcode === 'M_NOT_FOUND') {
        return undefined;
    }
    throw err;
}

interface MigrationOptions {
    migrateProfile: boolean,
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

    let lastError;
    const attempts = 5;
    for (let i = 0; i < attempts; i++) {
        try {
            await target.joinRoom(roomId);
            console.debug(`Successfully joined ${roomId} after an invite`);
            return;
        } catch (err: unknown) {
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
export function mergeDirectMessages(sourceDMs: DirectMessages, targetDMs: DirectMessages): DirectMessages {
    const dms: DirectMessages = JSON.parse(JSON.stringify(targetDMs));

    for (const key in sourceDMs) {
        if (!(key in dms)) {
            dms[key] = [];
        }
        // Remove duplicates. These makes migration safe to reapply
        dms[key] = Array.from(new Set([...dms[key], ...sourceDMs[key]]));
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

async function migrateAccountData(account: Account, target: sdk.MatrixClient) {
    const sourceDirectMessages = account.directMessages;
    const targetDirectMessages = await target.getAccountDataFromServer('m.direct') ?? {};
    await target.setAccountData('m.direct', mergeDirectMessages(sourceDirectMessages, targetDirectMessages));

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

export async function migrateAccount(source: sdk.MatrixClient, target: sdk.MatrixClient, account: Account, opts: MigrationOptions) {
    const roomJoinTasks: Promise<unknown>[] = [];
    const restrictedRooms = new Set<string>();

    for (const room of account.migratableRooms) {
        switch (room.joinRule) {
            case JoinRule.Public:
                roomJoinTasks.push(target.joinRoom(room.roomId));
                break;
            case JoinRule.Invite:
                roomJoinTasks.push(joinByInvite(source, target, room.roomId));
                break;
            case JoinRule.Restricted:
            case JoinRule.KnockRestricted:
                restrictedRooms.add(room.roomId);
                // fallthrough
            case JoinRule.Knock:
            case JoinRule.Private:
                throw new Error(`Room type ${room.joinRule} NYI`);

        }
    }

    await Promise.all(roomJoinTasks);
    await migrateAccountData(account, target);
    void opts; // if (opts.migrateProfile) { await migrateProfile(account, target); }
}

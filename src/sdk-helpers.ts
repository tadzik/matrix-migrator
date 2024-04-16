import { MigratorError } from './errors';
import * as sdk from "matrix-js-sdk";

class InvalidRoomError extends MigratorError {
    constructor(technicalDetails: string) {
        super('Room appears to be invalid', technicalDetails);
    }
}

export class IncompleteStateError extends InvalidRoomError {
    constructor(missingEventType: string) {
        super(`${missingEventType} state event is missing`);
    }
}

export class InvalidStateError extends InvalidRoomError {
    constructor(eventType: string, problem: string) {
        super(`Invalid contents of ${eventType}: ${problem}`);
    }
}

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

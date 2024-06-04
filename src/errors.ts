import { t } from 'i18next';

/** Migrator should not be using technical jargon, but errors should be as detailed as possible for development purposes.
 * Therefore, each of our errors has a user-friendly description, but stores the technical details also.
 */
export class MigratorError extends Error {
    constructor(
        public displayMessage: string,
        public technicalDetails: string,
    ) {
        super(`${displayMessage}: ${technicalDetails}`);
    }
}

export class RoomTombstonedError extends MigratorError {
    constructor(name: string, replacementRoom: string, reason: string) {
        super(
            t(`Room has been upgraded`),
            t('Room {{name}} has been replaced by {{replacementRoom}} ("{{reason}}")', {
                'name': name,
                'replacementRoom': replacementRoom,
                'reason': reason,
            })
        );
    }
}

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

export class HistoryLossError extends MigratorError {
    constructor(technicalDetails: string) {
        super("Message history will be lost due to room settings", technicalDetails);
    }
}

export class RoomNotJoinableError extends MigratorError {
    constructor(technicalDetails: string) {
        super("New account will not be able to join room: insufficient permissions", technicalDetails);
    }
}

export class PowerLevelUnobtainableError extends MigratorError {
    constructor(technicalDetails: string) {
        super("New account will lose some permissions in the room", technicalDetails);
    }
}

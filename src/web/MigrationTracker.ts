import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "../collector";
import { MigrationRequest, migrateAccount, Status as MigrationStatus } from "../migrator";

export interface MigrationState {
    finished: boolean,
    rooms: (MigratableRoom & { status?: MigrationStatus, error?: Error })[];
}

// Wraps the event emitter returned by migrateAccount
// into something that can be displayed in MigrationViewer
export class MigrationTracker {
    private roomStatus = new Map<string, MigrationStatus>();
    private roomError = new Map<string, Error>();
    private isFinished = false;

    constructor(
        source: sdk.MatrixClient,
        target: sdk.MatrixClient,
        private request: MigrationRequest,
        private onStateChanged: (state: MigrationState) => void
    ) {
        const migration = migrateAccount(source, target, request);
        migration.on('room', (roomId, status, error) => {
            this.roomStatus.set(roomId, status);
            if (error) {
                this.roomError.set(roomId, error);
            }
            this.rebuildState();
        });
        migration.on('accountData', (status, error) => { /* TODO */ });
        migration.on('profile', (status, error) => { /* TODO */ });
        migration.on('finished', () => {
            this.isFinished = true;
            this.rebuildState();
        });
    }

    private rebuildState(): void {
        const state: MigrationState = {
            finished: this.isFinished,
            rooms: []
        };
        for (const room of this.request.rooms) {
            state.rooms.push({
                ...room,
                status: this.roomStatus.get(room.roomId),
                error: this.roomError.get(room.roomId),
            });
        }

        this.onStateChanged(state);
    }
}


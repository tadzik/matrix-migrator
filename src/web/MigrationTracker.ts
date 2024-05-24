import * as sdk from "matrix-js-sdk";

import { MigratableRoom } from "../collector";
import { MigrationRequest, migrateAccount, Status as MigrationStatus } from "../migrator";

interface ItemStatus {
    status?: MigrationStatus,
    error?: Error,
}

export interface MigrationState {
    finished: boolean;
    lastMessage: string;
    rooms: (MigratableRoom & ItemStatus)[];
    accountData: ItemStatus;
    profile?: ItemStatus;
    request: MigrationRequest,
}

// Wraps the event emitter returned by migrateAccount
// into something that can be displayed in MigrationViewer
export class MigrationTracker {
    private messages: string[] = [];
    private roomStatus = new Map<string, MigrationStatus>();
    private roomError = new Map<string, Error>();
    private accountData: ItemStatus = {};
    private profile?: ItemStatus;
    private isFinished = false;

    constructor(
        source: sdk.MatrixClient,
        target: sdk.MatrixClient,
        private request: MigrationRequest,
        private onStateChanged: (state: MigrationState) => void
    ) {
        const migration = migrateAccount(source, target, request);
        migration.on('message', msg => {
            this.messages.push(msg);
            this.rebuildState();
        });
        migration.on('room', (roomId, status, error) => {
            this.roomStatus.set(roomId, status);
            if (error) {
                this.roomError.set(roomId, error);
            }
            this.rebuildState();
        });
        migration.on('accountData', (status, error) => {
            this.accountData = { status, error };
            this.rebuildState();
        });
        migration.on('profile', (status, error) => {
            this.profile = { status, error };
            this.rebuildState();
        });
        migration.on('finished', () => {
            this.isFinished = true;
            this.rebuildState();
        });
    }

    private rebuildState(): void {
        const state: MigrationState = {
            accountData: this.accountData,
            finished: this.isFinished,
            lastMessage: this.messages[this.messages.length - 1],
            profile: this.profile,
            request: this.request,
            rooms: [],
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


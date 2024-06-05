import React from 'react';
import * as sdk from "matrix-js-sdk";

import SourceAccount from './SourceAccount';
import TargetAccount from './TargetAccount';
import { MigrationRequest } from '../migrator';
import { MigrationTracker, MigrationState } from './MigrationTracker';

interface State {
    migrationRequest?: MigrationRequest,
    migrationState?: MigrationState,
    sourceAccount?: sdk.MatrixClient,
    targetAccount?: sdk.MatrixClient,
}

export function Not() {
    return <strong> NOT </strong>;
}

export default class App extends React.Component<unknown, State> {
    constructor(props: never) {
        super(props);
        this.state = {};
    }

    onMigrationConfigured(migrationRequest: MigrationRequest) {
        this.setState({ migrationRequest });
    }

    onSourceAccountSet(sourceAccount: sdk.MatrixClient) {
        this.setState({ sourceAccount });
    }

    onTargetAccountSet(targetAccount: sdk.MatrixClient) {
        this.setState({ targetAccount });
    }

    migrate() {
        new MigrationTracker(
            this.state.sourceAccount!,
            this.state.targetAccount!,
            this.state.migrationRequest!,
            (migrationState) => this.setState({ migrationState }),
        );
    }

    render() {
        return <>
            <header>
                <h1> Matrix Migrator </h1>
            </header>
            <main>
                <SourceAccount
                    onAccountSet={ this.onSourceAccountSet.bind(this) }
                    onMigrationConfigured={ this.onMigrationConfigured.bind(this) }
                />
                <TargetAccount
                    onAccountSet={ this.onTargetAccountSet.bind(this) }
                    migrationState={ this.state.migrationState }
                />
                { this.state.sourceAccount && this.state.targetAccount && this.state.migrationRequest && <>
                    <button
                        id="migration-button"
                        type="button"
                        onClick={ this.migrate.bind(this) }
                        disabled={ !!this.state.migrationState && !this.state.migrationState.finished }
                    >
                        Migrate account
                    </button>
                    <section id="migration-summary">
                        <details>
                            <summary> What is going to happen? </summary>
                            <ol>
                                <li> The new account will join (with an invite, if necessary) { this.state.migrationRequest!.rooms.length } rooms, in the order that they're shown </li>
                                <li> The old account will promote the new account to the correct Power Level, where necessary and possible </li>
                                <li> Your account data from the old account – which includes ignored users, notification settings, list of direct messages etc. – will get copied to the new account </li>
                                { this.state.migrationRequest.options.migrateProfile && <li>
                                    Your display name and profile picture of the new account will be set to that of the old account
                                </li> }
                                { this.state.migrationRequest.options.renameOldAccount !== false && <li>
                                    Your old account will have its display name changed
                                </li> }
                                { this.state.migrationRequest.options.leaveMigratedRooms && <li>
                                    Your old account will leave the { this.state.migrationRequest!.rooms.length } migrated rooms
                                </li> }
                                { this.state.migrationRequest.options.addOldMxidNotification && <li>
                                    A notification rule will be added, so that your new account will get notified when the old account is mentioned in a room
                                </li> }
                            </ol>
                        </details>
                    </section>
                    <section id="migration-caveats">
                        <details>
                            <summary> What is <Not /> going to happen? </summary>
                            <ol>
                                <li> Messages sent to the old account will <Not /> get forwarded to the new account </li>
                                <li> Messages sent from the old account will <Not /> be editable by the new account </li>
                                <li> The devices you verified with the old account will not be verified on the new account </li>
                            </ol>
                        </details>
                    </section>
                </> }
            </main>
        </>;
    }
}

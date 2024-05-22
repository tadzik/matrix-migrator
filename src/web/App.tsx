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
                { this.state.sourceAccount && this.state.targetAccount && this.state.migrationRequest &&
                    <button
                        id="migration-button"
                        type="button"
                        onClick={ this.migrate.bind(this) }
                        disabled={ !!this.state.migrationState && !this.state.migrationState.finished }
                    >
                        Migrate account
                    </button>
                }
            </main>
        </>;
    }
}

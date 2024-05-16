import React from 'react';

import SourceAccount from './SourceAccount';
import TargetAccount from './TargetAccount';
import { MigrationRequest } from '../migrator';

interface State {
    migration?: MigrationRequest,
}

export default class App extends React.Component<{}, State> {
    constructor(props: never) {
        super({});
        this.state = {};
    }

    onMigrationConfigured(migration: MigrationRequest) {
        this.setState({ migration });
    }

    render() {
        return <>
            <header>
                <h1> Matrix Migrator </h1>
            </header>
            <main>
                <SourceAccount onMigrationConfigured={ this.onMigrationConfigured.bind(this) }/>
                <TargetAccount migration={ this.state.migration } />
                { this.state.migration && <button id="migration-button" type="button"> MIGRATE! </button> }
            </main>
        </>;
    }
}

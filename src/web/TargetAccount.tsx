import React from 'react';
import * as sdk from "matrix-js-sdk";

import LoginForm from './LoginForm';
import MigrationStatus from './MigrationStatus';
import { MigrationRequest } from '../migrator';

enum AccountState {
    NeedsLogin,
    FetchingAccountInfo,
    AccountLoaded,
}

interface Props {
    migration?: MigrationRequest,
}

interface State {
    accountState: AccountState,
    client?: sdk.MatrixClient,
}
 
export default class TargetAccount extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {
            accountState: AccountState.NeedsLogin,
        };
    }

    setClient(client: sdk.MatrixClient) {
        this.setState({ client }, () => {
            this.fetchAccountInfo();
        });
    }

    switchAccount() {
        this.setState({
            accountState: AccountState.NeedsLogin,
        });
    }

    async fetchAccountInfo() {
        this.setState({ accountState: AccountState.FetchingAccountInfo });

        this.setState({ accountState: AccountState.AccountLoaded });
    }

    render() {
        let inner: React.ReactElement;

        switch (this.state.accountState) {
            case AccountState.NeedsLogin:
                inner = <LoginForm
                    formId="targetAccount"
                    onClientLoggedIn={ this.setClient.bind(this) }
                />;
                break;
            case AccountState.FetchingAccountInfo:
                inner = <> Loading account info </>;
                break;
            case AccountState.AccountLoaded:
                inner = <MigrationStatus
                    client={ this.state.client! }
                    onSwitchAccount={ this.switchAccount.bind(this) }
                    migration={ this.props.migration }
                />;
                break;
        }

        return <section id="target-account">
            <h2> Your new account </h2>
            { inner }
        </section>;
    }
}

import React from 'react';
import * as sdk from "matrix-js-sdk";
import { Account, MigratableRoom, UnavailableRoom, collectAccount } from "../collector";

import LoginForm from './LoginForm';
import AccountDetailsSelector from './AccountDetailsSelector';
import { checkForProblems, sortRooms } from '../problem-checker';

enum AccountState {
    NeedsLogin,
    FetchingAccountInfo,
    AccountLoaded,
}

interface Props {
}

interface State {
    accountState: AccountState,
    client?: sdk.MatrixClient,
    loadingProgress?: string,
    loadedAccount?: Account,
    selectableRooms: MigratableRoom[],
    unavailableRooms: UnavailableRoom[],
    skippedRooms: { [roomId: string]: boolean },
}

export default class SourceAccount extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {
            accountState: AccountState.NeedsLogin,
            skippedRooms: {},
            selectableRooms: [],
            unavailableRooms: [],
        };
    }

    checkAccount(account: Account) {
        console.warn("Will skip", this.state.skippedRooms);
        const [ok, nok] = checkForProblems(this.state.client!.getUserId()!, account.migratableRooms, (room) => this.state.skippedRooms[room.roomId]);
        account.unavailableRooms.forEach(room => nok.add(room));
        this.setState({
            selectableRooms: sortRooms(ok),
            unavailableRooms: Array.from(nok),
        });
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

        let account = await collectAccount(this.state.client!, (msg, count, total) => {
            const progress = count ? ` (${count}/${total ?? '?'})` : '';
            this.setState({ loadingProgress: msg + progress });
        });
        this.setState({ loadedAccount: account });

        this.checkAccount(account);
        this.setState({ accountState: AccountState.AccountLoaded });

        await this.state.client!.logout();
    }

    updateSkippedRooms(skippedRooms: { [roomId: string]: boolean }) {
        const account = this.state.loadedAccount!;
        this.setState({ skippedRooms }, () => this.checkAccount(account));
    }

    render() {
        switch (this.state.accountState) {
            case AccountState.NeedsLogin:
                return <LoginForm
                    onClientLoggedIn={ this.setClient.bind(this) }
                />
            case AccountState.FetchingAccountInfo:
                return <>
                    { this.state.loadingProgress }
                </>;
            case AccountState.AccountLoaded:
                return <AccountDetailsSelector
                    profileInfo={ this.state.loadedAccount!.profileInfo }
                    selectableRooms={ this.state.selectableRooms }
                    unavailableRooms={ this.state.unavailableRooms }
                    client={ this.state.client! }
                    onSkippedRoomsUpdated={ this.updateSkippedRooms.bind(this) }
                    onSwitchAccount={ this.switchAccount.bind(this) }
                />
        }
    }
}

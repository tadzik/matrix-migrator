import React from 'react';
import * as sdk from "matrix-js-sdk";
import { Account, MigratableRoom, UnavailableRoom, collectAccount } from "../collector";

import LoginForm from './LoginForm';
import AccountDetailsSelector from './AccountDetailsSelector';
import { checkForProblems, sortRooms } from '../problem-checker';
import { MigrationRequest } from '../migrator';

enum AccountState {
    NeedsLogin,
    FetchingAccountInfo,
    AccountLoaded,
}

interface Props {
    onAccountSet: (account: sdk.MatrixClient) => void,
    onMigrationConfigured: (migration: MigrationRequest) => void,
}

interface State {
    accountState: AccountState,
    client?: sdk.MatrixClient,
    loadingProgress?: string,
    loadedAccount?: Account,
    migrateProfile: boolean,
    selectableRooms: MigratableRoom[],
    unavailableRooms: UnavailableRoom[],
    roomsToMigrate: MigratableRoom[],
    skippedRooms: { [roomId: string]: boolean },
}

export default class SourceAccount extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {
            accountState: AccountState.NeedsLogin,
            migrateProfile: false,
            skippedRooms: {},
            roomsToMigrate: [],
            selectableRooms: [],
            unavailableRooms: [],
        };
    }

    checkAccount(account: Account) {
        console.warn("Will skip", this.state.skippedRooms);
        const [ok, nok] = checkForProblems(this.state.client!.getUserId()!, account.migratableRooms, (room) => this.state.skippedRooms[room.roomId]);
        account.unavailableRooms.forEach(room => nok.add(room));
        this.props.onMigrationConfigured({
            ...account,
            profileInfo: this.state.migrateProfile ? account.profileInfo : undefined,
            rooms: sortRooms(ok).filter(room => !this.state.skippedRooms[room.roomId]),
        });
        this.setState({
            selectableRooms: sortRooms(ok),
            unavailableRooms: Array.from(nok),
        });
    }

    onMigrateProfileChanged(migrateProfile: boolean) {
        this.setState({ migrateProfile }, () => this.checkAccount(this.state.loadedAccount!));
    }

    setClient(client: sdk.MatrixClient) {
        this.setState({ client }, () => {
            this.props.onAccountSet(client);
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

        const account = await collectAccount(this.state.client!, (msg, count, total) => {
            const progress = count ? ` (${count}/${total ?? '?'})` : '';
            this.setState({ loadingProgress: msg + progress });
        });
        this.setState({ loadedAccount: account });

        this.checkAccount(account);
        this.setState({ accountState: AccountState.AccountLoaded });
    }

    updateSkippedRooms(skippedRooms: { [roomId: string]: boolean }) {
        this.setState({ skippedRooms }, () => this.checkAccount(this.state.loadedAccount!));
    }

    render() {
        let inner: React.ReactElement;

        switch (this.state.accountState) {
            case AccountState.NeedsLogin:
                inner = <LoginForm
                    formId="sourceAccount"
                    onClientLoggedIn={ this.setClient.bind(this) }
                />;
                break;
            case AccountState.FetchingAccountInfo:
                inner = <>
                    { this.state.loadingProgress }
                </>;
                break;
            case AccountState.AccountLoaded:
                inner = <AccountDetailsSelector
                    migrateProfile={ this.state.migrateProfile }
                    profileInfo={ this.state.loadedAccount!.profileInfo }
                    selectableRooms={ this.state.selectableRooms }
                    unavailableRooms={ this.state.unavailableRooms }
                    client={ this.state.client! }
                    onMigrateProfileChanged={ this.onMigrateProfileChanged.bind(this) }
                    onSkippedRoomsUpdated={ this.updateSkippedRooms.bind(this) }
                    onSwitchAccount={ this.switchAccount.bind(this) }
                />;
                break;
        }

        return <section id="source-account">
            <h2> Your old account </h2>
            { inner }
        </section>;
    }
}

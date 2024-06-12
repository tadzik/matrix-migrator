import React from 'react';
import * as sdk from "matrix-js-sdk";
import { Account, MigratableRoom, UnavailableRoom, collectAccount } from "../collector";

import LoginForm from './LoginForm';
import AccountDetailsSelector, { MigrationOptions } from './AccountDetailsSelector';
import { checkForProblems, sortRooms } from '../problem-checker';
import { MigrationRequest } from '../migrator';

enum AccountState {
    NeedsLogin,
    FetchingAccountInfo,
    AccountLoaded,
}

interface Props {
    onAccountSet: (account?: sdk.MatrixClient) => void,
    onMigrationConfigured: (migration: MigrationRequest) => void,
}

interface State {
    accountState: AccountState,
    client?: sdk.MatrixClient,
    loadingProgress?: string,
    loadedAccount?: Account,
    migrationOptions: MigrationOptions,
    selectableRooms: MigratableRoom[],
    unavailableRooms: UnavailableRoom[],
    roomsToMigrate: MigratableRoom[],
    skippedRooms: { [roomId: string]: boolean },
}

export default class SourceAccount extends React.Component<Props, State> {
    formId = 'sourceAccount';

    constructor(props: Props) {
        super(props);

        this.state = {
            accountState: AccountState.NeedsLogin,
            migrationOptions: {
                addOldMxidNotification: false,
                leaveMigratedRooms: false,
                migrateProfile: false,
                renameOldAccount: null,
            },
            skippedRooms: {},
            roomsToMigrate: [],
            selectableRooms: [],
            unavailableRooms: [],
        };
    }

    checkAccount(account: Account) {
        const [ok, nok] = checkForProblems(this.state.client!.getUserId()!, account.migratableRooms, (room) => this.state.skippedRooms[room.roomId]);
        account.unavailableRooms.forEach(room => nok.add(room));
        this.props.onMigrationConfigured({
            ...account,
            rooms: sortRooms(ok).filter(room => !this.state.skippedRooms[room.roomId]),
            options: this.state.migrationOptions,
        });
        this.setState({
            selectableRooms: sortRooms(ok),
            unavailableRooms: Array.from(nok),
        });
    }

    onMigrationOptionChanged(key: keyof MigrationOptions, value: unknown) {
        this.setState((state) => ({
            ...state,
            migrationOptions: {
                ...state.migrationOptions,
                [key]: value,
            },
        }), () => this.checkAccount(this.state.loadedAccount!))
    }

    setClient(client: sdk.MatrixClient) {
        this.setState({ client }, () => {
            this.props.onAccountSet(client);
            this.fetchAccountInfo();
        });
    }

    switchAccount() {
        this.state.client!.logout().finally(() => {
            sessionStorage.removeItem(`${this.formId}:mxid`);
            sessionStorage.removeItem(`${this.formId}:accessToken`);
            this.props.onAccountSet(undefined);
            this.setState({
                accountState: AccountState.NeedsLogin,
            });
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
                    formId={ this.formId }
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
                    migrationOptions={ this.state.migrationOptions }
                    profileInfo={ this.state.loadedAccount!.profileInfo }
                    selectableRooms={ this.state.selectableRooms }
                    unavailableRooms={ this.state.unavailableRooms }
                    client={ this.state.client! }
                    onMigrationOptionChanged={ this.onMigrationOptionChanged.bind(this) }
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

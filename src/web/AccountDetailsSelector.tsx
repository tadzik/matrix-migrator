import React, { ChangeEvent } from 'react';
import * as sdk from "matrix-js-sdk";
import { MigratableRoom, ProfileInfo, UnavailableRoom } from "../collector";
import ProfileCard from './ProfileCard';
import RoomDetails from './RoomDetails';
import MigratorErrorComponent from './MigratorError';

export interface MigrationOptions {
    leaveMigratedRooms: boolean,
    migrateProfile: boolean,
    addOldMxidNotification: boolean,
    renameOldAccount: false|string,
}

const OPTIONS = [
    { key: 'leaveMigratedRooms',     displayName: "Leave migrated rooms" },
    { key: 'migrateProfile',         displayName: "Migrate profile" },
    { key: 'addOldMxidNotification', displayName: "Add a notification rule in your new account for your old username" },
    { key: 'renameOldAccount',       displayName: "Rename old account" },
];

interface Props {
    client: sdk.MatrixClient;
    migrationOptions: MigrationOptions,
    profileInfo: ProfileInfo,
    selectableRooms: MigratableRoom[];
    unavailableRooms: UnavailableRoom[];
    onMigrationOptionChanged: (key: keyof MigrationOptions, value: boolean) => void;
    onSwitchAccount: () => void;
    onSkippedRoomsUpdated: (skippedRooms: { [roomId: string]: boolean }) => void;
}

interface State {
    skipRoom: { [roomId: string]: boolean };
}

export default class SourceAccount extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {
            skipRoom: {},
        };
    }

    toggleRoom(roomId: string, ev: ChangeEvent<HTMLInputElement>) {
        this.setState({
            skipRoom: {
                ...this.state.skipRoom,
                [roomId]: !ev.target.checked
            },
        }, () => this.props.onSkippedRoomsUpdated(this.state.skipRoom));
    }

    toggleMigrationOption(key: keyof MigrationOptions, ev: ChangeEvent<HTMLInputElement>) {
        this.props.onMigrationOptionChanged(key, ev.target.checked);
    }

    render() {
        return <div className="account-selector">
            <ProfileCard 
                entityId={ this.props.client.getUserId() ?? '' }
                displayName={ this.props.profileInfo.displayname }
                avatarUrl={ sdk.getHttpUriForMxc(this.props.client.baseUrl, this.props.profileInfo.avatar_url)  }
            />
            <button type="button" onClick={ this.props.onSwitchAccount }> Use another account </button>
            <section>
                <h2> Options </h2>
                <ul>
                { OPTIONS.map(opt => <li key={ opt.key }>
                    <input type="checkbox" id={ opt.key }
                           checked={ this.props.migrationOptions[opt.key] }
                           onChange={ this.toggleMigrationOption.bind(this, opt.key) }
                    />
                    <label htmlFor={ opt.key }> { opt.displayName } </label>
                    { opt.key === 'renameOldAccount' && this.props.migrationOptions[opt.key] !== false && <>
                        <input type="text" size={ 72 } placeholder="Migrated to @migrationtarget1:home.tadzik.net" />
                    </> }
                </li>) }
                </ul>
            </section>
            <section>
                <h2> Rooms </h2>
                <ul>
                {
                    this.props.selectableRooms.map(room => <li key={ room.roomId } className="room-info">
                        <input type="checkbox" name="room"
                               checked={ !this.state.skipRoom[room.roomId] }
                               onChange={ this.toggleRoom.bind(this, room.roomId) }
                        />
                        <ProfileCard
                            entityId={ room.roomId }
                            displayName={ room.roomName }
                            avatarUrl={ room.roomAvatar && sdk.getHttpUriForMxc(this.props.client.baseUrl, room.roomAvatar)  }
                        />
                        <RoomDetails room={ room } />
                    </li>)
                }
                </ul>
                { this.props.unavailableRooms.length > 0 && <h2> Rooms impossible to migrate </h2> }
                {
                    Array.from(this.props.unavailableRooms).map(room =>
                        <div key={ room.roomId }>
                            <ProfileCard
                                key={ room.roomId }
                                entityId={ room.roomId }
                                displayName={ room.roomName }
                                avatarUrl={ sdk.getHttpUriForMxc(this.props.client.baseUrl, room.roomAvatar) }
                            >
                            </ProfileCard>
                            <MigratorErrorComponent error={ room.reason } />
                        </div>
                    )
                }
            </section>
        </div>;
    }
}

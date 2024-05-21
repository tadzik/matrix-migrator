import React, { ChangeEvent } from 'react';
import * as sdk from "matrix-js-sdk";
import { MigratableRoom, ProfileInfo, UnavailableRoom } from "../collector";
import ProfileCard from './ProfileCard';
import RoomDetails from './RoomDetails';
import MigratorErrorComponent from './MigratorError';

interface Props {
    client: sdk.MatrixClient;
    profileInfo: ProfileInfo,
    selectableRooms: MigratableRoom[];
    unavailableRooms: UnavailableRoom[];
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
        console.warn("Skipping state for", roomId, "is now", !ev.target.checked);
        this.setState({
            skipRoom: {
                ...this.state.skipRoom,
                [roomId]: !ev.target.checked
            },
        }, () => this.props.onSkippedRoomsUpdated(this.state.skipRoom));
    }
 
    render() {
        return <div className="account-selector">
            <ProfileCard 
                entityId={ this.props.client.getUserId() ?? '' }
                displayName={ this.props.profileInfo.displayname }
                avatarUrl={ sdk.getHttpUriForMxc(this.props.client.baseUrl, this.props.profileInfo.avatar_url)  }
            />
            <button type="button" onClick={ this.props.onSwitchAccount }> Use another account </button>
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
                    <>
                        <ProfileCard
                            key={ room.roomId }
                            entityId={ room.roomId }
                            displayName={ room.roomName }
                            avatarUrl={ sdk.getHttpUriForMxc(this.props.client.baseUrl, room.roomAvatar) }
                        >
                        </ProfileCard>
                        <MigratorErrorComponent error={ room.reason } />
                    </>
                )
            }
        </div>;
    }
}

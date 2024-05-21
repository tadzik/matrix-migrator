import React from 'react';
import * as sdk from "matrix-js-sdk";
import { ProfileInfo } from "../collector";
import ProfileCard from './ProfileCard';
import { MigrationState } from './MigrationTracker';
import { MigratorError } from '../errors';
import MigratorErrorComponent from './MigratorError';

interface Props {
    client: sdk.MatrixClient;
    onSwitchAccount: () => void;
    migration?: MigrationState;
}

interface State {
    profileInfo?: ProfileInfo,
}

export default class MigrationViewer extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {};
        void this.fetchProfileInfo();
    }

    async fetchProfileInfo() {
        const profileInfo = await this.props.client.getProfileInfo(this.props.client.getUserId()!);
        this.setState({ profileInfo });

    }
    render() {
        return <div className="account-selector">
            { this.state.profileInfo && 
                <ProfileCard 
                    entityId={ this.props.client.getUserId() ?? '' }
                    displayName={ this.state.profileInfo.displayname }
                    avatarUrl={ sdk.getHttpUriForMxc(this.props.client.baseUrl, this.state.profileInfo.avatar_url)  }
                />
            }
            { !this.state.profileInfo && <> Loading profile info... </> }
            <button type="button" onClick={ this.props.onSwitchAccount }> Use another account </button>
            <h2> Rooms </h2>
            <ul>
            { this.props.migration && this.props.migration.rooms.map(room => <li key={ room.roomId }>
                <ProfileCard
                    entityId={ room.roomId }
                    displayName={ room.roomName }
                    avatarUrl={ sdk.getHttpUriForMxc(this.props.client.baseUrl, room.roomAvatar) }
                />
                { room.status?.toString() ?? "Pending" }
                { room.error && <MigratorErrorComponent error={ room.error } /> }
            </li>) }
            </ul>
       </div>;
    }
}

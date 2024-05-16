import React from 'react';

interface Props {
    avatarUrl?: string;
    displayName?: string;
    entityId: string;
}

export default function ProfileCard(props: Props) {
    return <div>
        <div className="profile-card">
            { props.avatarUrl && <img src={ props.avatarUrl } /> }
            { !props.avatarUrl && <div className="img-fallback"> ? </div> }
            <div>
                <span className="display-name"> { props.displayName } </span>
                <br />
                <span className="entity-id"> { props.entityId } </span>
            </div>
        </div>
    </div>
}

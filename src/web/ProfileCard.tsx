import React from 'react';
import ImageMaybe from './ImageMaybe';

interface Props {
    avatarUrl?: string;
    displayName?: string;
    entityId: string;
}

export default function ProfileCard(props: Props) {
    return <div>
        <div className="profile-card">
            <ImageMaybe
                src={ props.avatarUrl }
                fallback={ props.displayName ?? props.entityId }
                alt={ `${props.displayName}'s picture` }
            />
            <div>
                <span className="display-name"> { props.displayName } </span>
                <br />
                <span className="entity-id"> { props.entityId } </span>
            </div>
        </div>
    </div>
}

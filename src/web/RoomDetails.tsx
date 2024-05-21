import React from 'react';
import { MigratableRoom } from '../collector';
import MigratorErrorComponent from './MigratorError';

interface Props {
    room: MigratableRoom;
}

export default function RoomDetails(props: Props) {
    return <div className='room-details'>
        { 
            props.room.problems && props.room.problems.map(problem => <MigratorErrorComponent error={ problem } />)
        }
    </div>;
}

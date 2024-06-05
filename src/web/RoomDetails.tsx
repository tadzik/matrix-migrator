import React from 'react';
import { MigratableRoom } from '../collector';
import MigratorErrorComponent from './MigratorError';

interface Props {
    room: MigratableRoom;
}

export default function RoomDetails(props: Props) {
    return <div className='room-details'>
        { 
            props.room.problems && <div>
                { props.room.problems.map((problem) => <>
                        <MigratorErrorComponent key={ problem.technicalDetails } error={ problem } /> <br />
                </>) }
            </div>
        }
    </div>;
}

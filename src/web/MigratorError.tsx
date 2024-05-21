import React from 'react';
import { MigratorError } from '../errors';

interface Props {
    error: Error;
}

export default function MigratorErrorComponent(props: Props) {
    return <span className="error">
        { props.error instanceof MigratorError && <>
            { props.error.displayMessage } <span className="technical-details" title={ props.error.technicalDetails }>&#x1f6c8;</span>
        </> }
        { !(props.error instanceof MigratorError) && <>
            { props.error.toString() }
        </> }
    </span>;
}

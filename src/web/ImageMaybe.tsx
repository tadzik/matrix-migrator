import React from 'react';

interface Props {
    imageClass?: string;
    src?: string;
    fallback: string;
    alt: string;
}

export default function ImageMaybe(props: Props) {
    const className = props.imageClass ?? "small-image";
    return <>
        { props.src && <img className={ className } src={ props.src } alt={ props.alt } /> }
        { !props.src && <div className={ "img-fallback " + className } title={ props.alt } > { props.fallback.substring(0, 1) } </div> }
    </>;
}

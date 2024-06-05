import React from 'react';
import * as sdk from "matrix-js-sdk";

enum LoginState {
    Form,
    Trying,
    LoggedIn,
}

interface Props {
    formId: string;
    onClientLoggedIn: (client: sdk.MatrixClient) => void;
}

interface State {
    loginState: LoginState,
    error?: string,
}

export default class LoginForm extends React.Component<Props, State> {
    mxidRef: React.RefObject<HTMLInputElement>;
    passwordRef: React.RefObject<HTMLInputElement>;

    constructor(props: Props) {
        super(props);

        this.mxidRef = React.createRef();
        this.passwordRef = React.createRef();

        this.state = {
            loginState: LoginState.Form,
        };
    }

    async login(ev?: React.FormEvent<HTMLFormElement>) {
        ev?.preventDefault();
        this.setState({ error: undefined });
        const userId = this.mxidRef.current!.value;
        const password = this.passwordRef.current!.value;

        let baseUrl: string;
        const [, domain] = userId.match('[^:]+:(.*)')!;
        try {
            const wellKnown = await sdk.AutoDiscovery.getRawClientConfig(domain);
            baseUrl = wellKnown['m.homeserver']!.base_url!;
        } catch (err: unknown) {
            console.error("Failed to determine base url:", err);
            // TODO
            if (userId.endsWith('home.tadzik.net')) {
                baseUrl = 'http://home.tadzik.net:8008';
            } else {
                baseUrl = 'https://' + domain;
            }
        }

        const client = sdk.createClient({ baseUrl, userId });
        try {
            const loginResponse = await client.loginWithPassword(userId, password);
            console.debug(loginResponse);
            this.props.onClientLoggedIn(client);
        } catch (err) {
            this.setState({ error: err.toString() });
        }
    }

    componentDidMount(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const env = (import.meta as any).env ?? {};
        if (env[`VITE_${this.props.formId}_MXID`]) {
            this.mxidRef.current!.value = env[`VITE_${this.props.formId}_MXID`];
            this.passwordRef.current!.value = env[`VITE_${this.props.formId}_PASSWORD`];
        }
    }

    render() {
        let error: React.JSX.Element|undefined;
        if (this.state.error) {
            error = <strong> Error: { this.state.error } </strong>;
        }
        return <form onSubmit={ this.login.bind(this) }>
            <label>
                Matrix ID:
                <input type="text" name="mxid" ref={ this.mxidRef } />
                <input type="password" name="password" ref={ this.passwordRef } />
                <input type="submit" value="Submit" />
            </label>
            { error }
        </form>;
    }
}

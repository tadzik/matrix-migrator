import React from 'react';
import * as sdk from "matrix-js-sdk";
import { MXID_REGEX } from "../sdk-helpers";
import ImageMaybe from './ImageMaybe';

interface SsoProvider {
    id: string;
    name: string;
    icon?: string;
}

interface Props {
    formId: string;
    onClientLoggedIn: (client: sdk.MatrixClient) => void;
}

interface State {
    error?: string;
    ssoStatus?: string;
    showMxidSpinner?: boolean;
    showPasswordPrompt?: boolean;
    ssoProviders?: SsoProvider[];
}

export default class LoginForm extends React.Component<Props, State> {
    mxidRef: React.RefObject<HTMLInputElement>;
    passwordRef: React.RefObject<HTMLInputElement>;
    flowsCheckDebounce?: NodeJS.Timeout;

    constructor(props: Props) {
        super(props);

        this.mxidRef = React.createRef();
        this.passwordRef = React.createRef();

        this.state = {};
    }

    async checkLoginFlows() {
        const userId = this.mxidRef.current!.value;

        let showPasswordPrompt = false;
        let ssoProviders: SsoProvider[]|undefined;
        try {
            const baseUrl = await this.getBaseUrl(userId);
            const client = sdk.createClient({ baseUrl, userId });
            const methods = await client.loginFlows();
            if (methods.flows.some(flow => flow.type === 'm.login.password')) {
                showPasswordPrompt = true;
            }
            const sso = methods.flows.find(flow => flow.type === 'm.login.sso');
            if (sso) {
                ssoProviders = (sso as sdk.SSOFlow).identity_providers?.map(provider => ({
                    id: provider.id,
                    name: provider.name,
                    icon: provider.icon && sdk.getHttpUriForMxc(baseUrl, provider.icon),
                }));
           }
        } catch (err: unknown) {
            console.error("Failed to determine base url:", err);
            return;
        } finally {
            this.setState({
                showMxidSpinner: false,
                showPasswordPrompt,
                ssoProviders,
            });
        }
    }

    async getBaseUrl(userId: string) {
        const domain = userId.match(MXID_REGEX)![2];
        const wellKnown = await sdk.AutoDiscovery.getRawClientConfig(domain);
        return wellKnown['m.homeserver']?.base_url ?? 'https://' + domain;;
    }

    onMxidChanged() {
        this.setState({ showMxidSpinner: true });
        if (this.flowsCheckDebounce) {
            clearTimeout(this.flowsCheckDebounce);
        }
        this.flowsCheckDebounce = setTimeout(() => {
            void this.checkLoginFlows();
        }, 500);
    }

    async loginWithSso(providerId: string) {
        const userId = this.mxidRef.current!.value;
        const baseUrl = await this.getBaseUrl(userId);
        const client = sdk.createClient({ baseUrl, userId });

        const url = new URL(window.location.href);
        const params = new URLSearchParams();
        params.set('formId', this.props.formId);
        params.set('mxid', this.mxidRef.current!.value);
        url.search = params.toString();

        window.location.href = client.getSsoLoginUrl(url.toString(), 'sso', providerId, sdk.SSOAction.LOGIN)
    }

    async login(ev?: React.FormEvent<HTMLFormElement>) {
        ev?.preventDefault();
        this.setState({ error: undefined });
        const userId = this.mxidRef.current!.value;
        sessionStorage.setItem(`${this.props.formId}:mxid`, this.mxidRef.current!.value);
        const password = this.passwordRef.current!.value;

        try {
            const baseUrl = await this.getBaseUrl(userId);
            const client = sdk.createClient({ baseUrl, userId });
            const loginResponse = await client.loginWithPassword(userId, password);
            sessionStorage.setItem(`${this.props.formId}:accessToken`, loginResponse.access_token);
            this.props.onClientLoggedIn(client);
        } catch (err) {
            this.setState({ error: err.toString() });
        }
    }

    componentDidMount(): void {
        const url = new URL(window.location.href);
        const params = new URLSearchParams(url.search);
        if (params.get('formId') === this.props.formId) {
            const userId = params.get('mxid')!;
            const loginToken = params.get('loginToken')!;
            this.setState({ ssoStatus: `Logging in as ${userId}` });
            this.getBaseUrl(userId).then(baseUrl => {
                const client = sdk.createClient({ baseUrl, userId });
                client.loginWithToken(loginToken).then(loginResponse => {
                    sessionStorage.setItem(`${this.props.formId}:mxid`, userId);
                    sessionStorage.setItem(`${this.props.formId}:accessToken`, loginResponse.access_token);
                    url.search = '';
                    window.location.href = url.toString();
                });
            });
        }
        const userId = sessionStorage.getItem(`${this.props.formId}:mxid`);
        if (userId) {
            const accessToken = sessionStorage.getItem(`${this.props.formId}:accessToken`);
            if (accessToken) {
                this.getBaseUrl(userId).then(baseUrl => {
                    const client = sdk.createClient({ baseUrl, userId, accessToken });
                    this.props.onClientLoggedIn(client);
                });
            }
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const env = (import.meta as any).env ?? {};
            if (env[`VITE_${this.props.formId}_MXID`]) {
                this.mxidRef.current!.value = env[`VITE_${this.props.formId}_MXID`];
                void this.checkLoginFlows();
            }
            if (env[`VITE_${this.props.formId}_PASSWORD`]) {
                this.passwordRef.current!.value = env[`VITE_${this.props.formId}_PASSWORD`];
                void this.login();
            }
        }
    }

    render() {
        let error: React.JSX.Element|undefined;
        if (this.state.error) {
            error = <strong> Error: { this.state.error } </strong>;
        }
        if (this.state.ssoStatus) {
            return <div>
                { this.state.ssoStatus } &nbsp; <span className="spinner" />
            </div>;
        }
        return <form onSubmit={ this.login.bind(this) }>
            <label>
                Matrix ID:&nbsp;
                <input type="text" name="mxid"
                    onChange={ this.onMxidChanged.bind(this) }
                    ref={ this.mxidRef }
                />
                { this.state.showMxidSpinner && <span className="spinner" /> }
                { this.state.showPasswordPrompt && <div>
                    Password login:
                    &nbsp;
                    <input type="password" name="password" ref={ this.passwordRef } />
                    &nbsp;
                    <input type="submit" value="Submit" />
                </div> }
                { this.state.ssoProviders && <div>
                    Delegated login:&nbsp;
                    { this.state.ssoProviders.map(provider => <>
                        <button type="button" key={ provider.id } onClick={ this.loginWithSso.bind(this, provider.id) }>
                            <ImageMaybe
                                src={ provider.icon }
                                fallback={ provider.name }
                                alt={ `Login with ${provider.name}` }
                                imageClass='tiny-image'
                            />
                            { provider.name }
                        </button>
                    </>) }
                </div> }
            </label>
            { error }
        </form>;
    }
}

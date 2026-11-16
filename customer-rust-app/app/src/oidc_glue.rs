// Copied from admin-rust-app/app/src/oidc_glue.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R3 (tasks T033): the browser half of sign-in, with the standards-based
//! `openidconnect` crate. Discovery with `ProviderMetadataWithLogout` (so `end_session_endpoint`
//! is known), the authorization-code request with PKCE `S256` and scope `openid profile`, the
//! code exchange with ID-token validation (Keycloak's `/certs` answers this origin with CORS
//! headers, so the signature is checked in the browser), the refresh-token grant, and
//! RP-initiated logout. The state machine that decides when each runs is `core::auth`.

use customer_rust_core::auth::{
    PendingSignIn, PkceStore, RenewError, Tokens, finish_sign_in, start_sign_in,
};
use openidconnect::{
    AuthorizationCode, ClientId, CsrfToken, EndpointMaybeSet, EndpointNotSet, EndpointSet,
    IssuerUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier,
    ProviderMetadataWithLogout, RedirectUrl, RefreshToken, RequestTokenError, Scope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient},
};

use crate::config;

type Client = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// `sessionStorage`, the one place the pending sign-in waits across the redirect.
pub struct SessionPkceStore;

impl SessionPkceStore {
    fn storage() -> Option<web_sys::Storage> {
        web_sys::window()?.session_storage().ok()?
    }
}

impl PkceStore for SessionPkceStore {
    fn get(&self, key: &str) -> Option<String> {
        Self::storage()?.get_item(key).ok()?
    }
    fn set(&mut self, key: &str, value: &str) {
        if let Some(s) = Self::storage() {
            let _ = s.set_item(key, value);
        }
    }
    fn remove(&mut self, key: &str) {
        if let Some(s) = Self::storage() {
            let _ = s.remove_item(key);
        }
    }
}

/// Milliseconds since the epoch, from the browser's clock.
pub fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

/// The page's origin, which is the redirect URI's base (spec 001 FR-005: exact, `origin + /`).
pub fn origin() -> String {
    web_sys::window()
        .and_then(|w| w.location().origin().ok())
        .unwrap_or_default()
}

/// The realm's discovered metadata and an HTTP client.
pub struct Oidc {
    metadata: ProviderMetadataWithLogout,
    http: reqwest::Client,
}

impl Oidc {
    /// Discovery at `config::OIDC_AUTHORITY`'s `.well-known/openid-configuration`, with its JWKS.
    pub async fn discover() -> Result<Oidc, String> {
        let http = reqwest::Client::new();
        let issuer =
            IssuerUrl::new(config::OIDC_AUTHORITY.to_string()).map_err(|e| e.to_string())?;
        let metadata = ProviderMetadataWithLogout::discover_async(issuer, &http)
            .await
            .map_err(|e| format!("discovery: {e}"))?;
        Ok(Oidc { metadata, http })
    }

    fn client(&self) -> Client {
        CoreClient::from_provider_metadata(
            self.metadata.clone(),
            ClientId::new(config::OIDC_CLIENT_ID.to_string()),
            None,
        )
        .set_redirect_uri(RedirectUrl::new(format!("{}/", origin())).expect("origin is a URL"))
    }

    /// The URL of Keycloak's sign-in page, after keeping the pending sign-in for the redirect.
    pub fn authorize_url(&self, store: &mut dyn PkceStore, return_to: &str) -> String {
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let (url, state, nonce) = self
            .client()
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("profile".into()))
            .set_pkce_challenge(challenge)
            .url();
        start_sign_in(
            store,
            &PendingSignIn {
                state: state.secret().clone(),
                code_verifier: verifier.secret().clone(),
                nonce: nonce.secret().clone(),
                return_to: return_to.to_string(),
            },
        );
        url.to_string()
    }

    /// The code exchange for the callback `?code&state`: the tokens, with the ID token's
    /// signature, issuer, audience, expiry, and nonce checked, and the page to return to. The
    /// pending sign-in is gone from storage whatever the outcome.
    pub async fn exchange(
        &self,
        store: &mut dyn PkceStore,
        code: &str,
        state: &str,
    ) -> Result<(Tokens, Option<String>), ()> {
        let pending = finish_sign_in(store, state).map_err(|_| ())?;
        let client = self.client();
        let response = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .map_err(|_| ())?
            .set_pkce_verifier(PkceCodeVerifier::new(pending.code_verifier))
            .request_async(&self.http)
            .await
            .map_err(|_| ())?;
        let id_token = response.id_token().ok_or(())?;
        // The ID token comes straight from the token endpoint over TLS-or-localhost. Its
        // signature, issuer, audience, and nonce are checked. Its `exp` and `iat` checks are off
        // on purpose: the verifier's clock is pinned to the token's own `iat`, so it can never be
        // expired or issued in the future. The device's clock may be wrong (spec 028's tests set
        // it days off), and oidc-client-ts, which the React app uses, does not refuse a token on
        // the device clock either.
        let issued = issued_at(&id_token.to_string()).ok_or(())?;
        let verifier = client.id_token_verifier().set_time_fn(move || issued);
        id_token
            .claims(&verifier, &Nonce::new(pending.nonce))
            .map_err(|_| ())?;
        let tokens = Tokens {
            access_token: response.access_token().secret().clone(),
            id_token: Some(id_token.to_string()),
            refresh_token: response.refresh_token().map(|t| t.secret().clone()),
            expires_at_ms: expires_at(response.expires_in()),
        };
        Ok((tokens, Some(pending.return_to)))
    }

    /// The refresh-token grant. Keycloak's own refusal (an OAuth error response) ends the
    /// session; anything else is "try again later" (spec 018 research R12).
    pub async fn refresh(
        &self,
        refresh_token: &str,
        id_token: Option<String>,
    ) -> Result<Tokens, RenewError> {
        let client = self.client();
        let token = RefreshToken::new(refresh_token.to_string());
        let request = client
            .exchange_refresh_token(&token)
            .map_err(|_| RenewError::Other)?;
        match request.request_async(&self.http).await {
            Ok(response) => Ok(Tokens {
                access_token: response.access_token().secret().clone(),
                id_token: response.id_token().map(|t| t.to_string()).or(id_token),
                refresh_token: response
                    .refresh_token()
                    .map(|t| t.secret().clone())
                    .or_else(|| Some(refresh_token.to_string())),
                expires_at_ms: expires_at(response.expires_in()),
            }),
            Err(RequestTokenError::ServerResponse(_)) => Err(RenewError::Refused),
            Err(_) => Err(RenewError::Other),
        }
    }

    /// RP-initiated logout: the end-session endpoint with `id_token_hint`, `client_id`, and
    /// `post_logout_redirect_uri` = origin + `/` (parity S3).
    pub fn logout_url(&self, id_token_hint: Option<&str>) -> String {
        let end = self
            .metadata
            .additional_metadata()
            .end_session_endpoint
            .as_ref()
            .map(|e| e.url().clone())
            .unwrap_or_else(|| {
                openidconnect::url::Url::parse(&format!(
                    "{}/protocol/openid-connect/logout",
                    config::OIDC_AUTHORITY
                ))
                .expect("authority is a URL")
            });
        let mut url = end;
        {
            let mut q = url.query_pairs_mut();
            if let Some(hint) = id_token_hint {
                q.append_pair("id_token_hint", hint);
            }
            q.append_pair("client_id", config::OIDC_CLIENT_ID);
            q.append_pair("post_logout_redirect_uri", &format!("{}/", origin()));
        }
        url.to_string()
    }
}

fn expires_at(expires_in: Option<std::time::Duration>) -> i64 {
    // Keycloak always sends expires_in; 5 minutes is its default token life.
    now_ms() + expires_in.map(|d| d.as_millis() as i64).unwrap_or(300_000)
}

/// A JWT's `iat`, read without verifying (the verifier then checks the signature).
fn issued_at(jwt: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    use base64::Engine;
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    chrono::DateTime::from_timestamp(claims["iat"].as_i64()?, 0)
}

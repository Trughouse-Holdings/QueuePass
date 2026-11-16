// Copied from admin-rust-app/core/src/auth/mod.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R3, data-model.md `AuthState` (tasks T026): sign-in, as
//! `packages/shared/src/web/auth-provider.tsx` does it, as a pure state machine. The browser
//! glue (`app/src/oidc_glue.rs`) performs each [`Effect`] with the `openidconnect` crate and
//! feeds the outcome back; time comes in as milliseconds from an injected clock, never
//! `std::time::SystemTime` (which panics in `wasm32-unknown-unknown`).
//!
//! - Tokens live in memory only (Constitution V). A reload starts sign-in again, which Keycloak's
//!   own session answers without asking for the password.
//! - Only the one-time PKCE verifier and `state` cross the redirect, in `sessionStorage`
//!   ([`PkceStore`]), and are removed at once after the code exchange.
//! - Renewal: a refresh-token grant shortly before expiry. A renewal that fails for any reason but
//!   Keycloak's refusal keeps the user and is retried at once, every 30 s, and when the browser
//!   comes back online; Keycloak's refusal ends the session (spec 018 research R12).

use base64::Engine;
use serde::{Deserialize, Serialize};

/// The role the Rust Customer app admits (spec 001 FR-016; spec 040 R2).
pub const REQUIRED_ROLE: &str = "customer";

/// The QueuePass roles a token's realm roles are filtered to (`isRole`).
pub const QUEUEPASS_ROLES: [&str; 3] = ["queuepass-admin", "customer", "gate-agent"];

/// oidc-client-ts' `accessTokenExpiringNotificationTimeInSeconds` default: renew a minute early.
pub const RENEW_BEFORE_MS: i64 = 60_000;

/// Spec 018 research R12: how often a failed renewal is retried while the user is kept.
pub const RENEW_RETRY_MS: i64 = 30_000;

/// The tokens of one sign-in, held in memory only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tokens {
    pub access_token: String,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    /// When the access token expires, in milliseconds since the epoch.
    pub expires_at_ms: i64,
}

/// What the app shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthStatus {
    /// Before the first check ("Signing in…").
    Loading,
    /// On the way to Keycloak's page ("Signing in…").
    SigningIn,
    /// Signed in with the admin role: the app.
    SignedIn,
    /// Signed in without the admin role: the wrong-role page with Log out (S4).
    WrongRole,
    /// Logged out, on the way to Keycloak's end-session page.
    SignedOut,
}

/// Something the browser glue must do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    /// Start the authorization-code request with PKCE, coming back to `return_to`.
    RedirectToSignIn { return_to: String },
    /// Exchange the `code` in the URL (with the stored verifier) for tokens.
    ExchangeCode,
    /// `history.replaceState` to this path.
    ReplaceUrl(String),
    /// The refresh-token grant, with no page navigation.
    Refresh,
    /// RP-initiated logout through the realm's `end_session_endpoint`.
    EndSession { id_token_hint: Option<String> },
}

/// Why a renewal failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenewError {
    /// Keycloak refused it (an OAuth error such as `invalid_grant`): the session is over.
    Refused,
    /// Anything else (no network, a timeout, a captive portal): try again later.
    Other,
}

/// The username and QueuePass roles in an access token, read without verifying (the Backend
/// verifies every token).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Claims {
    pub username: Option<String>,
    pub roles: Vec<String>,
}

/// `claimsOf`: the token's `preferred_username` and its `realm_access.roles` that are QueuePass
/// roles. A token that does not read has no roles.
pub fn claims_of(access_token: &str) -> Claims {
    let Some(payload) = access_token.split('.').nth(1) else {
        return Claims::default();
    };
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let Ok(bytes) = engine.decode(payload.trim_end_matches('=')) else {
        return Claims::default();
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Claims::default();
    };
    Claims {
        username: json["preferred_username"].as_str().map(str::to_string),
        roles: json["realm_access"]["roles"]
            .as_array()
            .map(|roles| {
                roles
                    .iter()
                    .filter_map(|r| r.as_str())
                    .filter(|r| QUEUEPASS_ROLES.contains(r))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The sign-in state machine.
#[derive(Clone, Debug)]
pub struct AuthMachine {
    status: AuthStatus,
    tokens: Option<Tokens>,
    claims: Claims,
    renew_failed: bool,
    renewing: bool,
    logging_out: bool,
    /// When the last retry of a failed renewal started; `None` retries at the next tick.
    last_retry_ms: Option<i64>,
}

impl Default for AuthMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthMachine {
    pub fn new() -> Self {
        AuthMachine {
            status: AuthStatus::Loading,
            tokens: None,
            claims: Claims::default(),
            renew_failed: false,
            renewing: false,
            logging_out: false,
            last_retry_ms: None,
        }
    }

    pub fn status(&self) -> AuthStatus {
        self.status
    }

    /// The current access token, for the API client and the seat stream.
    pub fn access_token(&self) -> Option<&str> {
        self.tokens.as_ref().map(|t| t.access_token.as_str())
    }

    pub fn username(&self) -> Option<&str> {
        self.claims.username.as_deref()
    }

    pub fn roles(&self) -> Vec<String> {
        self.claims.roles.clone()
    }

    /// The ID token, kept for a renewal that brings none and for logout's `id_token_hint`.
    pub fn id_token(&self) -> Option<&str> {
        self.tokens.as_ref().and_then(|t| t.id_token.as_deref())
    }

    /// The refresh token the next renewal sends.
    pub fn refresh_token(&self) -> Option<&str> {
        self.tokens
            .as_ref()
            .and_then(|t| t.refresh_token.as_deref())
    }

    pub fn renew_failed(&self) -> bool {
        self.renew_failed
    }

    fn apply(&mut self, tokens: Tokens) {
        self.claims = claims_of(&tokens.access_token);
        self.status = if self.claims.roles.iter().any(|r| r == REQUIRED_ROLE) {
            AuthStatus::SignedIn
        } else {
            AuthStatus::WrongRole
        };
        self.tokens = Some(tokens);
        self.renew_failed = false;
        self.last_retry_ms = None;
    }

    fn redirect(&mut self, return_to: &str) -> Vec<Effect> {
        self.status = AuthStatus::SigningIn;
        vec![Effect::RedirectToSignIn {
            return_to: return_to.to_string(),
        }]
    }

    /// The first check on load: finish a redirect back from Keycloak, or go sign in (nothing is
    /// kept across a reload). `search` is `location.search`, with its `?`.
    pub fn start(&mut self, path: &str, search: &str) -> Vec<Effect> {
        let query = search.trim_start_matches('?');
        let has = |key: &str| {
            query
                .split('&')
                .any(|pair| pair.split('=').next() == Some(key))
        };
        if has("code") && has("state") {
            return vec![Effect::ExchangeCode];
        }
        self.redirect(&format!("{path}{search}"))
    }

    /// The code exchange answered: the tokens and the page asked for, or a stale or replayed
    /// code, which is dropped from the URL before a fresh sign-in.
    pub fn code_exchanged(
        &mut self,
        outcome: Result<(Tokens, Option<String>), ()>,
        path: &str,
    ) -> Vec<Effect> {
        match outcome {
            Ok((tokens, return_to)) => {
                self.apply(tokens);
                let to = return_to
                    .filter(|r| r.starts_with('/'))
                    .unwrap_or_else(|| "/".into());
                vec![Effect::ReplaceUrl(to)]
            }
            Err(()) => {
                let mut effects = vec![Effect::ReplaceUrl(path.to_string())];
                effects.extend(self.redirect(path));
                effects
            }
        }
    }

    /// Sends the browser to Keycloak's page (a 401 from the API does this), unless logging out.
    /// The status is kept, so the page stays up until the browser leaves, as `signIn` in
    /// `auth-provider.tsx` (a cancelled leave question keeps the admin's work).
    pub fn sign_in(&mut self, here: &str) -> Vec<Effect> {
        if self.logging_out {
            return vec![];
        }
        vec![Effect::RedirectToSignIn {
            return_to: here.to_string(),
        }]
    }

    /// Time passes: the scheduled renewal, an expiry, or the next retry of a failed renewal.
    pub fn tick(&mut self, now_ms: i64) -> Vec<Effect> {
        let Some(tokens) = &self.tokens else {
            return vec![];
        };
        if self.renewing || self.logging_out {
            return vec![];
        }
        // oidc-client-ts' accessTokenExpired: the user is kept, and the renewal retried.
        if now_ms >= tokens.expires_at_ms {
            self.renew_failed = true;
        }
        if self.renew_failed {
            let due = self
                .last_retry_ms
                .is_none_or(|last| now_ms - last >= RENEW_RETRY_MS);
            if !due {
                return vec![];
            }
            self.last_retry_ms = Some(now_ms);
            self.renewing = true;
            return vec![Effect::Refresh];
        }
        if now_ms >= tokens.expires_at_ms - RENEW_BEFORE_MS {
            self.renewing = true;
            return vec![Effect::Refresh];
        }
        vec![]
    }

    /// The browser is back online: retry a failed renewal now.
    pub fn online(&mut self) -> Vec<Effect> {
        if !self.renew_failed || self.renewing || self.logging_out || self.tokens.is_none() {
            return vec![];
        }
        self.renewing = true;
        vec![Effect::Refresh]
    }

    /// A renewal answered.
    pub fn refreshed(
        &mut self,
        outcome: Result<Tokens, RenewError>,
        _now_ms: i64,
        here: &str,
    ) -> Vec<Effect> {
        self.renewing = false;
        if self.logging_out {
            // A renewal in flight isn't cancelled by logout: drop what it brings, so logout still
            // ends this session (spec 001 SC-007).
            return vec![];
        }
        match outcome {
            Ok(tokens) => {
                self.apply(tokens);
                vec![]
            }
            Err(RenewError::Refused) => {
                self.tokens = None;
                self.claims = Claims::default();
                self.renew_failed = false;
                self.last_retry_ms = None;
                self.redirect(here)
            }
            Err(RenewError::Other) => {
                self.renew_failed = true;
                vec![]
            }
        }
    }

    /// The page was shown again; `persisted` when restored from the back-forward cache, which
    /// keeps its JavaScript state, so sign-in is checked again (spec 001 SC-007).
    pub fn page_show(&mut self, persisted: bool, now_ms: i64, here: &str) -> Vec<Effect> {
        if !persisted {
            return vec![];
        }
        if self.tokens.is_none() {
            self.logging_out = false;
            return self.redirect(here);
        }
        self.tick(now_ms)
    }

    /// Spec 040 R2 (parity S5): the start of Log out, while release on logout runs with the
    /// token still in memory. From here no sign-in starts and no renewal is sent, and a renewal
    /// that answers is dropped (`loggingOut` in `auth-provider.tsx`); `logout` follows.
    pub fn begin_logout(&mut self) {
        self.logging_out = true;
        self.renew_failed = false;
    }

    /// Whether Log out has begun.
    pub fn is_logging_out(&self) -> bool {
        self.logging_out
    }

    /// Log out: memory first, so nothing signed in is left, then Keycloak's session.
    pub fn logout(&mut self) -> Vec<Effect> {
        let id_token_hint = self.tokens.as_ref().and_then(|t| t.id_token.clone());
        self.logging_out = true;
        self.renew_failed = false;
        self.tokens = None;
        self.claims = Claims::default();
        self.status = AuthStatus::SignedOut;
        vec![Effect::EndSession { id_token_hint }]
    }
}

/// The `sessionStorage` key of the one pending sign-in.
pub const PKCE_KEY: &str = "qp.customer-rust.signin";

/// Where the pending sign-in waits across the redirect: `sessionStorage` in the browser, memory
/// in tests.
pub trait PkceStore {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&mut self, key: &str, value: &str);
    fn remove(&mut self, key: &str);
}

/// An in-memory [`PkceStore`].
#[derive(Clone, Debug, Default)]
pub struct MemoryPkceStore(std::collections::BTreeMap<String, String>);

impl MemoryPkceStore {
    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl PkceStore for MemoryPkceStore {
    fn get(&self, key: &str) -> Option<String> {
        self.0.get(key).cloned()
    }
    fn set(&mut self, key: &str, value: &str) {
        self.0.insert(key.to_string(), value.to_string());
    }
    fn remove(&mut self, key: &str) {
        self.0.remove(key);
    }
}

/// What crosses the redirect: the PKCE verifier, `state`, the ID token's nonce, and the page to
/// come back to. Not a token.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingSignIn {
    pub state: String,
    pub code_verifier: String,
    pub nonce: String,
    pub return_to: String,
}

/// Why a callback could not be finished.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PkceError {
    /// No pending sign-in (a replayed or stale callback).
    Missing,
    /// The callback's `state` is not the one sent.
    StateMismatch,
}

/// Keeps the pending sign-in for the redirect, replacing any older one.
pub fn start_sign_in(store: &mut dyn PkceStore, pending: &PendingSignIn) {
    let json = serde_json::to_string(pending).expect("serializes");
    store.set(PKCE_KEY, &json);
}

/// Takes the pending sign-in back for the callback whose `state` is given. It is removed whatever
/// the outcome, so nothing is left in storage after the exchange.
pub fn finish_sign_in(store: &mut dyn PkceStore, state: &str) -> Result<PendingSignIn, PkceError> {
    let value = store.get(PKCE_KEY);
    store.remove(PKCE_KEY);
    let pending: PendingSignIn = value
        .and_then(|v| serde_json::from_str(&v).ok())
        .ok_or(PkceError::Missing)?;
    if pending.state != state {
        return Err(PkceError::StateMismatch);
    }
    Ok(pending)
}

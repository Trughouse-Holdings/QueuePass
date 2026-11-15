//! Spec 037 research R3 (tasks T033, T034): sign-in wired into the app. One context holds the
//! `core::auth` state machine (in a signal) and the API client; this module performs the effects
//! the machine asks for with `oidc_glue`, drives its clock, and listens for `online` and
//! `pageshow`, as `packages/shared/src/web/auth-provider.tsx` does.

use std::{rc::Rc, time::Duration};

use admin_rust_core::{
    api::client::ApiClient,
    auth::{AuthMachine, AuthStatus, Effect},
};
use leptos::{prelude::*, task::spawn_local};
use wasm_bindgen::JsCast;

use crate::{
    config,
    oidc_glue::{Oidc, SessionPkceStore, now_ms},
};

/// The signed-in app's context: copyable handles to the state machine, the realm's metadata,
/// and the API client.
#[derive(Clone, Copy)]
pub struct Auth {
    machine: RwSignal<AuthMachine>,
    oidc: StoredValue<Option<Rc<Oidc>>, LocalStorage>,
    api: StoredValue<ApiClient, LocalStorage>,
}

/// The page here, as `returnTo`: pathname and search, no hash (parity S2b).
pub fn here() -> String {
    let location = window().location();
    format!(
        "{}{}",
        location.pathname().unwrap_or_default(),
        location.search().unwrap_or_default()
    )
}

impl Auth {
    /// Makes the context, provides it, and starts sign-in.
    pub fn provide() -> Auth {
        let machine = RwSignal::new(AuthMachine::new());
        let oidc = StoredValue::new_local(None);
        // The client reads the token and the 401 action through the machine, which exists now.
        let token =
            Rc::new(move || machine.with_untracked(|m| m.access_token().map(str::to_string)));
        let auth_cell: Rc<std::cell::OnceCell<Auth>> = Rc::new(std::cell::OnceCell::new());
        let on_401 = {
            let cell = auth_cell.clone();
            Rc::new(move || {
                if let Some(auth) = cell.get() {
                    auth.sign_in();
                }
            })
        };
        let api = StoredValue::new_local(ApiClient::new(config::API_BASE_URL, token, on_401));
        let auth = Auth { machine, oidc, api };
        let _ = auth_cell.set(auth);
        provide_context(auth);
        auth.start();
        auth
    }

    pub fn status(&self) -> AuthStatus {
        self.machine.with(|m| m.status())
    }

    pub fn username(&self) -> Option<String> {
        self.machine.with(|m| m.username().map(str::to_string))
    }

    /// The API client (Constitution I: the only network path to data).
    pub fn api(&self) -> ApiClient {
        self.api.get_value()
    }

    /// The current access token, untracked (the seat stream's `Authorization` header).
    pub fn access_token(&self) -> Option<String> {
        self.machine
            .with_untracked(|m| m.access_token().map(str::to_string))
    }

    /// Updates the machine, performs what it asks, then lets the views see the change. Effects
    /// that change the URL run before the views render, so the router starts on the page asked
    /// for (039 R13).
    fn step(&self, f: impl FnOnce(&mut AuthMachine) -> Vec<Effect>) {
        let mut effects = Vec::new();
        self.machine.update_untracked(|m| effects = f(m));
        self.perform(effects);
        self.machine.notify();
    }

    fn start(&self) {
        let auth = *self;
        spawn_local(async move {
            match Oidc::discover().await {
                Ok(oidc) => auth.oidc.set_value(Some(Rc::new(oidc))),
                Err(e) => {
                    // As oidc-client-ts: the page stays on "Signing in…".
                    leptos::logging::error!("sign-in: {e}");
                    return;
                }
            }
            let location = window().location();
            let path = location.pathname().unwrap_or_default();
            let search = location.search().unwrap_or_default();
            auth.step(|m| m.start(&path, &search));
            auth.listen();
        });
    }

    fn listen(&self) {
        let auth = *self;
        set_interval(
            move || auth.step(|m| m.tick(now_ms())),
            Duration::from_secs(1),
        );
        let _ = window_event_listener(leptos::ev::online, move |_| auth.step(|m| m.online()));
        let _ = window_event_listener_untyped("pageshow", move |ev| {
            let persisted = ev
                .dyn_ref::<web_sys::PageTransitionEvent>()
                .is_some_and(|e| e.persisted());
            let here = here();
            auth.step(|m| m.page_show(persisted, now_ms(), &here));
        });
    }

    /// Sends the browser to sign in, coming back here (a 401 from the API does this).
    pub fn sign_in(&self) {
        let here = here();
        self.step(|m| m.sign_in(&here));
    }

    /// Log out: memory first, then Keycloak's end-session page (parity S3).
    pub fn logout(&self) {
        self.step(|m| m.logout());
    }

    fn perform(&self, effects: Vec<Effect>) {
        let Some(oidc) = self.oidc.get_value() else {
            return;
        };
        for effect in effects {
            match effect {
                Effect::RedirectToSignIn { return_to } => {
                    let url = oidc.authorize_url(&mut SessionPkceStore, &return_to);
                    let _ = window().location().assign(&url);
                }
                Effect::ExchangeCode => {
                    let auth = *self;
                    let oidc = oidc.clone();
                    spawn_local(async move {
                        let params = web_sys::UrlSearchParams::new_with_str(
                            &window().location().search().unwrap_or_default(),
                        )
                        .ok();
                        let get =
                            |k: &str| params.as_ref().and_then(|p| p.get(k)).unwrap_or_default();
                        let outcome = oidc
                            .exchange(&mut SessionPkceStore, &get("code"), &get("state"))
                            .await;
                        let path = window().location().pathname().unwrap_or_default();
                        auth.step(|m| m.code_exchanged(outcome, &path));
                    });
                }
                Effect::ReplaceUrl(path) => {
                    if let Ok(history) = window().history() {
                        let _ = history.replace_state_with_url(
                            &wasm_bindgen::JsValue::NULL,
                            "",
                            Some(&path),
                        );
                    }
                }
                Effect::Refresh => {
                    let auth = *self;
                    let oidc = oidc.clone();
                    let (refresh, id_token) = self.machine.with_untracked(|m| {
                        (
                            m.refresh_token().map(str::to_string),
                            m.id_token().map(str::to_string),
                        )
                    });
                    spawn_local(async move {
                        let outcome = match refresh {
                            Some(r) => oidc.refresh(&r, id_token).await,
                            None => Err(admin_rust_core::auth::RenewError::Refused),
                        };
                        let here = here();
                        auth.step(|m| m.refreshed(outcome, now_ms(), &here));
                    });
                }
                Effect::EndSession { id_token_hint } => {
                    let url = oidc.logout_url(id_token_hint.as_deref());
                    let _ = window().location().assign(&url);
                }
            }
        }
    }
}

/// The context, from any view under the app.
pub fn use_auth() -> Auth {
    expect_context::<Auth>()
}

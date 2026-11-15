//! Parity S6 (`packages/shared/src/web/hello-page.tsx`): the home page's greeting from
//! `GET /hello/admin`, which proves the sign-in chain end to end.

use admin_rust_core::api::client::ApiError;
use leptos::{prelude::*, task::spawn_local};

use crate::{
    auth::use_auth,
    components::{ServiceUnreachable, WrongRole},
};

#[derive(Clone)]
enum State {
    Loading,
    Ok { app_name: String, message: String },
    Unreachable,
    Forbidden,
}

#[component]
pub fn Home() -> impl IntoView {
    let auth = use_auth();
    let state = RwSignal::new(State::Loading);
    spawn_local(async move {
        let next = match auth.api().hello_admin().await {
            Ok(hello) => State::Ok {
                app_name: hello["appName"].as_str().unwrap_or_default().to_string(),
                message: hello["message"].as_str().unwrap_or_default().to_string(),
            },
            // The client already sent the browser to sign in.
            Err(ApiError::Status(e)) if e.status == 401 => return,
            Err(ApiError::Status(e)) if e.status == 403 => State::Forbidden,
            Err(_) => State::Unreachable,
        };
        state.set(next);
    });
    move || match state.get() {
        State::Loading => view! { <p>"Loading…"</p> }.into_any(),
        State::Unreachable => view! { <ServiceUnreachable/> }.into_any(),
        State::Forbidden => view! { <WrongRole/> }.into_any(),
        State::Ok { app_name, message } => view! {
            <section>
                <h1>{app_name}</h1>
                <p>{message}</p>
            </section>
        }
        .into_any(),
    }
}

//! Parity S7, S8: the wrong-role card and the unreachable banner (`wrong-role.tsx`,
//! `service-unreachable.tsx`, `require-role.tsx`).

use leptos::prelude::*;

use crate::auth::use_auth;

/// Spec 001 FR-016: a plain explanation and Log out, nothing else (parity S7).
#[component]
pub fn WrongRole() -> impl IntoView {
    let auth = use_auth();
    view! {
        <div class="card">
            <h1 class="page-title">"Your account can't use this app."</h1>
            {move || auth.username().map(|u| view! { <p>"You are signed in as " {u} "."</p> })}
            <p>
                <button type="button" class="btn btn--primary" on:click=move |_| auth.logout()>
                    "Log out"
                </button>
            </p>
        </div>
    }
}

/// Spec 001 FR-017: never a blank page when the Backend is down (parity S8).
#[component]
pub fn ServiceUnreachable() -> impl IntoView {
    view! {
        <p role="alert" class="banner banner--error">
            "Can't reach the QueuePass service."
        </p>
    }
}

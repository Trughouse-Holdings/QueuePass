//! Parity S4, S5, S9, S10: the wrong-role card, the unreachable banner, the error banner, and the
//! one-time notices (`wrong-role.tsx`, `service-unreachable.tsx`, `ErrorBanner.tsx`,
//! `Notice.tsx`, `SuccessState.tsx`).

use admin_rust_core::api::client::ApiError;
use leptos::prelude::*;
use leptos_router::NavigateOptions;
use leptos_router::hooks::{use_location, use_navigate};
use serde::{Deserialize, Serialize};

use crate::{auth::use_auth, components::AppLink};

/// Spec 001 FR-016: a plain explanation and Log out, nothing else (parity S4).
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

/// Spec 001 FR-017: never a blank page when the Backend is down (parity S5).
#[component]
pub fn ServiceUnreachable() -> impl IntoView {
    view! {
        <p role="alert" class="banner banner--error">
            "Can't reach the QueuePass service."
        </p>
    }
}

/// Explicit success state (FR-033).
#[component]
pub fn SuccessState(#[prop(into)] message: String) -> impl IntoView {
    view! {
        <div role="status" data-testid="success-state" class="banner banner--success">
            <span class="banner__icon" aria-hidden="true">"✓"</span>
            <div class="banner__body">
                <p>{message}</p>
            </div>
        </div>
    }
}

fn string_list(error: &ApiError, key: &str) -> Vec<String> {
    error
        .details()
        .and_then(|d| d.get(key))
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Branches on the envelope `code`, never on the message (FR-036). `SCHEDULING_CONFLICT` has its
/// own look, told apart from errors by icon, border, and heading, not hue alone (parity S9).
#[component]
pub fn ErrorBanner(
    error: ApiError,
    /// Overrides the "Could not save" heading, for example "Could not delete".
    #[prop(optional, into)]
    title: Option<String>,
) -> impl IntoView {
    let code = error.code().unwrap_or("VALIDATION_FAILED").to_string();
    let conflict = code == "SCHEDULING_CONFLICT";
    let fields = string_list(&error, "fields");
    let candidates = string_list(&error, "candidates");
    let events: Vec<(String, String)> = if code == "TIME_ZONE_HAS_ORDERS" {
        error
            .details()
            .and_then(|d| d.get("events"))
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|e| {
                        Some((
                            e["id"].as_str()?.to_string(),
                            e["name"].as_str()?.to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let heading = if conflict {
        "Venue already committed".to_string()
    } else {
        title.unwrap_or_else(|| "Could not save".into())
    };
    let message = error.message().to_string();
    view! {
        <div
            role="alert"
            data-testid="error-banner"
            data-code=code
            class=if conflict { "banner banner--conflict" } else { "banner banner--error" }
        >
            <span class="banner__icon" aria-hidden="true">{if conflict { "◆" } else { "✕" }}</span>
            <div class="banner__body">
                <strong>{heading}</strong>
                <p>{message}</p>
                {(!fields.is_empty()).then(|| view! {
                    <ul>{fields.into_iter().map(|f| view! { <li>{f}</li> }).collect_view()}</ul>
                })}
                {(!events.is_empty()).then(|| view! {
                    <ul>
                        {events.into_iter().map(|(id, name)| view! {
                            <li><AppLink href=format!("/events/{id}")>{name}</AppLink></li>
                        }).collect_view()}
                    </ul>
                })}
                {(!candidates.is_empty()).then(|| view! {
                    <ul>{candidates.into_iter().map(|c| view! { <li>{c}</li> }).collect_view()}</ul>
                })}
            </div>
        </div>
    }
}

/// A one-time notice's kind (parity S10).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoticeKind {
    Success,
    Info,
}

/// A one-time notice handed over by navigation, in the history entry's state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoticeState {
    pub kind: NoticeKind,
    pub text: String,
}

/// Navigation options carrying a notice in the history state, as the React app's
/// `navigate(to, { state: { notice } })`.
pub fn with_notice(kind: NoticeKind, text: impl Into<String>) -> NavigateOptions {
    let notice = NoticeState {
        kind,
        text: text.into(),
    };
    let state = serde_wasm_state(&notice);
    NavigateOptions {
        state: leptos_router::location::State::new(state),
        ..NavigateOptions::default()
    }
}

fn serde_wasm_state(notice: &NoticeState) -> Option<wasm_bindgen::JsValue> {
    let json = serde_json::json!({ "notice": notice }).to_string();
    js_sys::JSON::parse(&json).ok()
}

/// Shows a notice handed over by navigation once, then replaces the history entry with no state
/// so Back or a reload doesn't show it again (parity S10).
#[component]
pub fn Notice() -> impl IntoView {
    let location = use_location();
    let navigate = use_navigate();
    let notice: Option<NoticeState> = location.state.with_untracked(|s| {
        let value = s.to_js_value();
        let json = js_sys::JSON::stringify(&value).ok()?.as_string()?;
        let parsed: serde_json::Value = serde_json::from_str(&json).ok()?;
        serde_json::from_value(parsed.get("notice")?.clone()).ok()
    });
    if notice.is_some() {
        let path = location.pathname.get_untracked();
        let search = location.search.get_untracked();
        let to = if search.is_empty() {
            path
        } else {
            format!("{path}?{search}")
        };
        navigate(
            &to,
            NavigateOptions {
                replace: true,
                scroll: false,
                ..NavigateOptions::default()
            },
        );
    }
    notice.map(|n| match n.kind {
        NoticeKind::Success => view! { <SuccessState message=n.text/> }.into_any(),
        NoticeKind::Info => view! {
            <div role="status" class="banner">
                <div class="banner__body"><p>{n.text}</p></div>
            </div>
        }
        .into_any(),
    })
}

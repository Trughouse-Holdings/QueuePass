// Copied from admin-rust-app/app/src/components/link.rs at 680b4f7 (spec 040 R4).
//! In-app links. Every link is a plain `<a href>`, which the router turns into an in-app
//! navigation.

use leptos::prelude::*;
use leptos_router::hooks::use_location;

/// A link to another page of the app.
#[component]
pub fn AppLink(
    #[prop(into)] href: String,
    #[prop(optional, into)] class: Option<String>,
    children: Children,
) -> impl IntoView {
    view! { <a href=href class=class>{children()}</a> }
}

/// Whether `pathname` is `to` or under it, segment by segment (React Router's `NavLink`).
pub fn is_active(pathname: &str, to: &str) -> bool {
    pathname == to || pathname.starts_with(&format!("{}/", to.trim_end_matches('/')))
}

/// React Router's `NavLink`: `active_class` added and `aria-current="page"` while the location is
/// `href` or under it (parity S7).
#[component]
pub fn NavLink(
    #[prop(into)] href: String,
    #[prop(into)] class: String,
    #[prop(into)] active_class: String,
    children: Children,
) -> impl IntoView {
    let location = use_location();
    let to = href.clone();
    let active = Memo::new(move |_| is_active(&location.pathname.get(), &to));
    view! {
        <a
            href=href
            class=move || if active.get() { format!("{class} {active_class}") } else { class.clone() }
            aria-current=move || active.get().then_some("page")
        >
            {children()}
        </a>
    }
}

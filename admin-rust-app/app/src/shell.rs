//! Parity S7, S13 (`admin-app/src/App.tsx`): the sticky top bar and the page under it, the layout
//! of every route.

use leptos::prelude::*;
use leptos_router::{components::Outlet, hooks::use_location};

use crate::{auth::use_auth, components::NavLink};

/// Spec 039 research R14: the layout editor is full width under the top bar.
pub fn is_editor_path(pathname: &str) -> bool {
    let parts: Vec<&str> = pathname.trim_matches('/').split('/').collect();
    parts.len() >= 3 && parts[0] == "locations" && parts[2] == "layouts"
}

#[component]
pub fn AppShell() -> impl IntoView {
    let auth = use_auth();
    let location = use_location();
    let main_class = move || {
        if is_editor_path(&location.pathname.get()) {
            "main main--full"
        } else {
            "main"
        }
    };
    view! {
        <div class="app">
            <header class="topbar">
                <div class="topbar__inner">
                    <NavLink href="/locations" class="brand" active_class="active">
                        <span class="brand__mark" aria-hidden="true">"Q"</span>
                        "QueuePass Admin (Rust)"
                    </NavLink>
                    <nav class="navlinks">
                        <NavLink href="/locations" class="navlink" active_class="navlink--active">
                            "Venues"
                        </NavLink>
                        <NavLink href="/events" class="navlink" active_class="navlink--active">
                            "Events"
                        </NavLink>
                        // Spec 041 (R11, R12): between Events and Reports.
                        <NavLink href="/seasons" class="navlink" active_class="navlink--active">
                            "Seasons"
                        </NavLink>
                        <NavLink href="/reports" class="navlink" active_class="navlink--active">
                            "Reports"
                        </NavLink>
                    </nav>
                    <button type="button" on:click=move |_| auth.logout()>"Log out"</button>
                </div>
            </header>
            <main class=main_class>
                <Outlet/>
            </main>
        </div>
    }
}

/// Parity S12: no not-found page of the app's own; the router's default error screen, as React
/// Router shows it, with no top bar.
#[component]
pub fn NotFound() -> impl IntoView {
    view! {
        <h2>"Unexpected Application Error!"</h2>
        <h3 style="font-style: italic">"404 Not Found"</h3>
    }
}

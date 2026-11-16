//! Parity S9, S11, SL1 (`customer-app/src/App.tsx`): the sticky top bar and the page under it,
//! the layout of every route. The brand is plain text (a `<p>`, no mark), as the React app's.

use leptos::prelude::*;
use leptos_router::components::Outlet;

use crate::{auth::use_auth, components::NavLink};

#[component]
pub fn AppShell() -> impl IntoView {
    let auth = use_auth();
    view! {
        <div class="app">
            <header class="topbar">
                <div class="topbar__inner">
                    <p class="brand">"QueuePass Tickets (Rust)"</p>
                    <nav class="navlinks">
                        <NavLink href="/events" class="navlink" active_class="navlink--active">
                            "Events"
                        </NavLink>
                        <NavLink href="/venues" class="navlink" active_class="navlink--active">
                            "Venues"
                        </NavLink>
                        <NavLink href="/my-tickets" class="navlink" active_class="navlink--active">
                            "My tickets"
                        </NavLink>
                        <NavLink href="/cart" class="navlink" active_class="navlink--active">
                            "Cart"
                        </NavLink>
                    </nav>
                    <button type="button" on:click=move |_| auth.logout()>"Log out"</button>
                </div>
            </header>
            <main class="main">
                <Outlet/>
            </main>
        </div>
    }
}

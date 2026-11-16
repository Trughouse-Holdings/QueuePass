//! Parity S11, SL12 (`App.tsx` `NotFound`): inside the shell, "Page not found." and the two links
//! on one line, one space between.

use leptos::prelude::*;

use crate::components::AppLink;

#[component]
pub fn NotFound() -> impl IntoView {
    view! {
        <section>
            <p>"Page not found."</p>
            <AppLink href="/events">"Events"</AppLink>
            " "
            <AppLink href="/venues">"Venues"</AppLink>
        </section>
    }
}

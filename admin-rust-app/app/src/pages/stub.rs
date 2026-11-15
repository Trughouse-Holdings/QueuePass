//! Placeholders for the screens still being ported; each is replaced by its own module.

use leptos::prelude::*;

macro_rules! stub {
    ($($name:ident => $title:literal),* $(,)?) => {
        $(
            #[component]
            pub fn $name() -> impl IntoView {
                view! { <h1 class="page-title">$title</h1> }
            }
        )*
    };
}

stub! {
    LayoutEditor => "Layout",
    EventDetail => "Event",
}

// Copied from admin-rust-app/app/src/components/address_link.rs at 680b4f7 (spec 040 R4).
//! `packages/shared/src/web/address-link.tsx`: a venue's address as a Google Maps link in a new
//! tab that cannot reach this page (spec 013 FR-014, FR-015).

use customer_rust_core::format::maps_url;
use leptos::prelude::*;

#[component]
pub fn AddressLink(#[prop(into)] address: String) -> impl IntoView {
    view! {
        <a
            href=maps_url(&address)
            target="_blank"
            rel="noopener noreferrer"
            aria-label=format!("{address} (opens Google Maps in a new tab)")
        >
            {address.clone()}
        </a>
    }
}

//! Parity V1, V3, SL4 (`customer-app/src/pages/VenueList.tsx`): every venue, in the order the
//! Backend returns them (by name), in a bare table (no card, no `.table-wrap`). Read-only.

use customer_rust_core::{api::client::ApiClient, load::Load};
use leptos::prelude::*;

use crate::{
    components::{AddressLink, AppLink, ServiceUnreachable, event_card::count},
    load::use_load,
};

#[component]
pub fn VenueList() -> impl IntoView {
    let load = use_load(
        || (),
        |api: ApiClient, ()| async move { api.list_locations().await },
    );
    let state = move || {
        load.with(|l| match l {
            Load::Loading => view! { <p>"Loading…"</p> }.into_any(),
            Load::Unreachable | Load::Missing => view! { <ServiceUnreachable/> }.into_any(),
            Load::Ok(venues) if venues.is_empty() => view! { <p>"No venues yet."</p> }.into_any(),
            Load::Ok(venues) => {
                let rows = venues
                    .iter()
                    .map(|v| {
                        let name = v.name.to_string();
                        view! {
                            <tr>
                                <td>
                                    <AppLink href=format!("/venues/{}", v.id)>{name}</AppLink>
                                </td>
                                <td>
                                    <AddressLink address=v.address.to_string()/>
                                </td>
                                <td>{count(v.seating_capacity.get())}</td>
                            </tr>
                        }
                    })
                    .collect_view();
                view! {
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">"Venue"</th>
                                <th scope="col">"Address"</th>
                                <th scope="col">"Seating capacity"</th>
                            </tr>
                        </thead>
                        <tbody>{rows}</tbody>
                    </table>
                }
                .into_any()
            }
        })
    };
    view! {
        <section>
            <h1 class="page-title">"Venues"</h1>
            {state}
        </section>
    }
}

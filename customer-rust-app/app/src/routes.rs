//! Parity S11 (`customer-app/src/App.tsx`): every route under one shell, with the not-found
//! section inside it. The router starts after sign-in, on the page asked for.

use leptos::prelude::*;
use leptos_router::{
    components::{ParentRoute, Route, Router, Routes},
    path,
};

use crate::{pages, shell::AppShell};

#[component]
pub fn AppRoutes() -> impl IntoView {
    view! {
        <Router>
            <Routes fallback=|| view! { <AppShell/> }>
                <ParentRoute path=path!("") view=AppShell>
                    // The event list is the landing page (spec 003); `/` stays `/`.
                    <Route path=path!("") view=pages::event_list::EventList/>
                    <Route path=path!("events") view=pages::event_list::EventList/>
                    <Route path=path!("events/:id") view=pages::event_detail::EventDetail/>
                    <Route path=path!("venues") view=pages::venue_list::VenueList/>
                    <Route path=path!("venues/:id") view=pages::venue_detail::VenueDetail/>
                    <Route path=path!("my-tickets") view=pages::my_tickets::MyTickets/>
                    <Route path=path!("cart") view=pages::cart::Cart/>
                    <Route
                        path=path!("my-tickets/:ticketId/print")
                        view=pages::print_ticket::PrintTicket
                    />
                    <Route
                        path=path!("my-tickets/:ticketId/entry-code")
                        view=pages::entry_code::EntryCode
                    />
                    <Route path=path!("*any") view=pages::not_found::NotFound/>
                </ParentRoute>
            </Routes>
        </Router>
    }
}

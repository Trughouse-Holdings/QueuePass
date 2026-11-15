//! Parity S13 (`admin-app/src/App.tsx`): every route under one shell. The router starts after
//! sign-in, on the page asked for (039 R13).

use leptos::prelude::*;
use leptos_router::{
    components::{ParentRoute, Route, Router, Routes},
    path,
};

use crate::{
    pages,
    shell::{AppShell, NotFound},
};

#[component]
pub fn AppRoutes() -> impl IntoView {
    view! {
        <Router>
            <Routes fallback=|| view! { <NotFound/> }>
                <ParentRoute path=path!("") view=AppShell>
                    <Route path=path!("") view=pages::home::Home/>
                    <Route path=path!("locations") view=pages::venue_list::VenueList/>
                    <Route path=path!("locations/new") view=pages::venue_form::VenueForm/>
                    <Route path=path!("locations/:id") view=pages::venue_detail::VenueDetail/>
                    <Route path=path!("locations/:id/edit") view=pages::venue_form::VenueForm/>
                    <Route path=path!("locations/:id/layouts/new") view=pages::stub::LayoutEditor/>
                    <Route
                        path=path!("locations/:id/layouts/:layoutId/edit")
                        view=pages::stub::LayoutEditor
                    />
                    <Route path=path!("events") view=pages::event_list::EventList/>
                    <Route path=path!("events/new") view=pages::event_form::EventForm/>
                    <Route path=path!("events/:id") view=pages::stub::EventDetail/>
                    <Route path=path!("events/:id/edit") view=pages::event_form::EventForm/>
                    <Route path=path!("events/:id/attendees") view=pages::attendees::Attendees/>
                    <Route path=path!("reports") view=pages::reports::Reports/>
                </ParentRoute>
            </Routes>
        </Router>
    }
}

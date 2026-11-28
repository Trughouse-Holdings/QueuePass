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
                    <Route path=path!("locations/:id/layouts/new") view=crate::layout_editor::LayoutEditorPage/>
                    <Route
                        path=path!("locations/:id/layouts/:layoutId/edit")
                        view=crate::layout_editor::LayoutEditorPage
                    />
                    <Route path=path!("events") view=pages::event_list::EventList/>
                    <Route path=path!("events/new") view=pages::event_form::EventForm/>
                    <Route path=path!("events/:id") view=pages::event_detail::EventDetail/>
                    <Route path=path!("events/:id/edit") view=pages::event_form::EventForm/>
                    <Route path=path!("events/:id/attendees") view=pages::attendees::Attendees/>
                    // Spec 041 (R11, R12): the Seasons list, a new Season, and one Season's page.
                    <Route path=path!("seasons") view=pages::seasons::Seasons/>
                    <Route path=path!("seasons/new") view=pages::season_form::SeasonForm/>
                    <Route path=path!("seasons/:id") view=pages::season_form::SeasonForm/>
                    <Route path=path!("reports") view=pages::reports::Reports/>
                </ParentRoute>
            </Routes>
        </Router>
    }
}

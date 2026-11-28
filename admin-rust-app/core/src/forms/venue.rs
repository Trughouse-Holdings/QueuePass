//! Spec 037 T041 (parity V2, V3, V4, V8, V9, V10, M7): the New venue and Edit venue form,
//! ported from `admin-app/src/pages/LocationForm.tsx`, with `US_STATES` and `ZIP_PATTERN` of
//! `packages/shared/src/location.ts` and the refusal banner of
//! `admin-app/src/components/ErrorBanner.tsx`.
//!
//! [`VenueFormState`] holds what the React component keeps in state; its methods are the
//! component's derived values (which hints show, what a save sends) and its handlers. The view
//! binds the fields to the public fields and calls the `on_*` methods with each answer. Every
//! text is the React app's.

use serde_json::{Map, Value, json};

use super::layouts::{capacity_note, largest_capacity};
use super::section_lines::{
    LevelColor, LevelLine, LinesDraft, SelectOption, js_number, js_trim, json_number, total_text,
};
use crate::api::client::ApiError;
use crate::api::types::{LayoutSummary, Location};
use crate::format::venue_zone;
use crate::time::{DEFAULT_TIME_ZONE, US_TIME_ZONES, zone_name};

// ---------------------------------------------------------------- location.ts

/// One entry of `US_STATES` (`packages/shared/src/location.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UsStateEntry {
    /// Two-letter postal code, `KY`.
    pub code: &'static str,
    /// `Kentucky`.
    pub name: &'static str,
}

const fn st(code: &'static str, name: &'static str) -> UsStateEntry {
    UsStateEntry { code, name }
}

/// `US_STATES` (`location.ts`, spec 013 FR-001): the 50 states and DC, in the contract's
/// `UsState` order.
pub const US_STATES: [UsStateEntry; 51] = [
    st("AL", "Alabama"),
    st("AK", "Alaska"),
    st("AZ", "Arizona"),
    st("AR", "Arkansas"),
    st("CA", "California"),
    st("CO", "Colorado"),
    st("CT", "Connecticut"),
    st("DE", "Delaware"),
    st("DC", "District of Columbia"),
    st("FL", "Florida"),
    st("GA", "Georgia"),
    st("HI", "Hawaii"),
    st("ID", "Idaho"),
    st("IL", "Illinois"),
    st("IN", "Indiana"),
    st("IA", "Iowa"),
    st("KS", "Kansas"),
    st("KY", "Kentucky"),
    st("LA", "Louisiana"),
    st("ME", "Maine"),
    st("MD", "Maryland"),
    st("MA", "Massachusetts"),
    st("MI", "Michigan"),
    st("MN", "Minnesota"),
    st("MS", "Mississippi"),
    st("MO", "Missouri"),
    st("MT", "Montana"),
    st("NE", "Nebraska"),
    st("NV", "Nevada"),
    st("NH", "New Hampshire"),
    st("NJ", "New Jersey"),
    st("NM", "New Mexico"),
    st("NY", "New York"),
    st("NC", "North Carolina"),
    st("ND", "North Dakota"),
    st("OH", "Ohio"),
    st("OK", "Oklahoma"),
    st("OR", "Oregon"),
    st("PA", "Pennsylvania"),
    st("RI", "Rhode Island"),
    st("SC", "South Carolina"),
    st("SD", "South Dakota"),
    st("TN", "Tennessee"),
    st("TX", "Texas"),
    st("UT", "Utah"),
    st("VT", "Vermont"),
    st("VA", "Virginia"),
    st("WA", "Washington"),
    st("WV", "West Virginia"),
    st("WI", "Wisconsin"),
    st("WY", "Wyoming"),
];

/// `ZIP_PATTERN` (`location.ts`): 5 digits, or ZIP+4.
pub const ZIP_PATTERN: &str = r"^\d{5}(-\d{4})?$";

/// `ZIP_PATTERN.test(zip)`: 5 ASCII digits, optionally a hyphen and 4 more.
pub fn is_zip(zip: &str) -> bool {
    let b = zip.as_bytes();
    let digits = |s: &[u8]| s.iter().all(u8::is_ascii_digit);
    match b.len() {
        5 => digits(b),
        10 => digits(&b[..5]) && b[5] == b'-' && digits(&b[6..]),
        _ => false,
    }
}

/// The State select's options: "Choose a state", then "Kentucky (KY)" for each state.
pub fn state_options() -> Vec<SelectOption> {
    std::iter::once(SelectOption {
        value: String::new(),
        label: "Choose a state".into(),
    })
    .chain(US_STATES.iter().map(|s| SelectOption {
        value: s.code.into(),
        label: format!("{} ({})", s.name, s.code),
    }))
    .collect()
}

// ---------------------------------------------------------------- LocationForm.tsx

/// The page's subtitle.
pub const SUBTITLE: &str = "Name, address, and how many seats it holds.";
/// The title of the address problems banner.
pub const PROBLEMS_TITLE: &str = "Check the address";
/// `ZONE_REQUIRED`: under the select on New venue with no zone chosen.
pub const ZONE_REQUIRED: &str = "Choose the venue's time zone.";
/// `ZONE_CHANGE_NOTE`: when the zone changed on a venue that has or may have events.
pub const ZONE_CHANGE_NOTE: &str = "Changing the time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times move. Not possible once tickets are sold.";
/// The zone hint on New venue.
pub const NEW_ZONE_HINT: &str = "Event times at this venue are shown and entered in this zone.";
/// The zone hint once the address changed on Edit venue.
pub const ADDRESS_ZONE_HINT: &str = "Changing the address doesn't change the time zone. Choose another zone here if the venue is in a different one.";
/// The typed Seating capacity's hint.
pub const CAPACITY_HINT: &str = "An event scheduled here cannot sell more tickets than this. A seating layout, once added on the venue page, sets it instead.";
/// The note on a non-legacy venue whose address is not verified.
pub const UNVERIFIED_NOTE: &str = "This address is not verified. Saving checks it again.";
/// The banner when New venue › Seated saved the venue but not its layout.
pub const LAYOUT_REFUSED_TITLE: &str = "Seating layout not saved";
pub const LAYOUT_REFUSED_TEXT: &str = "The venue was created without its seating layout.";
pub const LAYOUT_REFUSED_LINK: &str = "Add the layout on its page";

/// `FIRST_LAYOUT` (spec 038 T019): the name of a seated venue's first layout.
pub const FIRST_LAYOUT: &str = "Standard";

/// `FIRST_LEVEL`: `{ name: 'Standard', color: 'violet' }`.
pub fn first_level() -> LevelLine {
    LevelLine {
        name: "Standard".into(),
        color: LevelColor::Violet,
    }
}

/// `Address` (`LocationForm.tsx`): the four fields as typed; `state` is a code or ''.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Address {
    pub street: String,
    pub city: String,
    pub state: String,
    pub zip: String,
}

impl Address {
    fn fields(&self) -> [&str; 4] {
        [&self.street, &self.city, &self.state, &self.zip]
    }
}

/// `addressProblems` (spec 013 FR-013): each problem the Backend would name, in field order.
pub fn address_problems(a: &Address) -> Vec<&'static str> {
    let mut problems = Vec::new();
    if js_trim(&a.street).is_empty() {
        problems.push("Street address is required.");
    }
    if js_trim(&a.city).is_empty() {
        problems.push("City is required.");
    }
    if a.state.is_empty() {
        problems.push("Choose a state.");
    }
    if !is_zip(js_trim(&a.zip)) {
        problems.push("ZIP code must be 5 digits, or 5 digits, a hyphen, and 4 digits.");
    }
    problems
}

/// `(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()`.
fn norm(s: Option<&str>) -> String {
    let mut out = String::new();
    let mut space = false;
    for c in js_trim(s.unwrap_or("")).chars() {
        if c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}') {
            space = true;
        } else {
            if space {
                out.push(' ');
                space = false;
            }
            out.push(c);
        }
    }
    out.to_uppercase()
}

/// `sameAsStored` (spec 013 FR-008, on the form's side): the address equals the venue's, ignoring
/// case and extra spaces, the ZIP code by its first 5; with no venue or a legacy one, all blank.
pub fn same_as_stored(a: &Address, v: Option<&Location>) -> bool {
    let Some(v) = v.filter(|v| v.street.is_some()) else {
        return a.fields().iter().all(|x| js_trim(x).is_empty());
    };
    let zip5: String = js_trim(&a.zip).chars().take(5).collect();
    norm(Some(&a.street)) == norm(v.street.as_deref().map(String::as_str))
        && norm(Some(&a.city)) == norm(v.city.as_deref().map(String::as_str))
        && v.state.is_some_and(|s| s.to_string() == a.state)
        && v.zip.as_deref().is_some_and(|z| *z == zip5)
}

/// A one-time notice's look (`NoticeState['notice']['kind']`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoticeKind {
    /// ✓ `banner--success`.
    Success,
    /// A plain `.banner`.
    Info,
}

impl NoticeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NoticeKind::Success => "success",
            NoticeKind::Info => "info",
        }
    }
}

/// A one-time notice for the Venues list (parity S10).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub kind: NoticeKind,
    pub text: String,
}

fn zone_text(v: &Location) -> String {
    venue_zone(
        Some(&v.time_zone.to_string()),
        Some(&v.time_zone_source.to_string()),
    )
}

/// `savedNotice` (spec 013 FR-012, 020 R14, 024 FR-014): the notice after a save, from the venue
/// as saved.
pub fn saved_notice(v: &Location) -> Notice {
    let address = v.address.as_str();
    if v.address_verified {
        return Notice {
            kind: NoticeKind::Success,
            text: format!(
                "Venue saved. Address: {address}. Time zone: {}.",
                zone_text(v)
            ),
        };
    }
    let how = if v.street.is_none() {
        "To verify it, edit the venue and enter its street, city, state, and ZIP code. "
    } else {
        "The US address service couldn't confirm it, so check that it's right: customers see this address and its map link. To verify it later, edit the venue and save it, correcting the address if it's wrong. "
    };
    Notice {
        kind: NoticeKind::Info,
        text: format!(
            "Venue saved, but its address is not verified: {address}. {how}Time zone: {}.",
            zone_text(v)
        ),
    }
}

/// New venue's Seating radios (spec 008 US5).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SeatingKind {
    #[default]
    General,
    Seated,
}

/// One line under the Time zone select, its `id` also in the select's `aria-describedby`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZoneHint {
    pub id: &'static str,
    pub text: String,
    /// `role="alert"` (only the problem).
    pub alert: bool,
}

/// What stands where Seating capacity goes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CapacityField {
    /// New venue › Seated: the section lines, then this total ("Total: 70 seats").
    Lines { total: String },
    /// Read-only, never sent: the largest layout's seats, described by `hint` (M7).
    FromLayouts { value: u64, hint: String },
    /// The typed number box, with [`CAPACITY_HINT`].
    Typed,
}

/// The request a save makes.
#[derive(Clone, Debug, PartialEq)]
pub enum SaveRequest {
    /// `POST /locations` (`LocationInput`), then, for a seated venue, `POST
    /// /locations/{id}/layouts` with `layout` (`LayoutLinesInput`).
    Create { body: Value, layout: Option<Value> },
    /// `PATCH /locations/{id}` (`LocationUpdate`).
    Update { id: String, body: Value },
}

/// The "Seating layout not saved" banner (V10).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayoutRefused {
    pub venue_id: String,
    /// The refusal's message.
    pub message: String,
    /// "Add the layout on its page" → `/locations/{id}`.
    pub href: String,
    /// When the venue's address is not verified: "Its address is saved but not verified: …".
    pub not_verified: Option<String>,
}

/// The state of `LocationForm` (data-model `VenueFormState`).
#[derive(Clone, Debug)]
pub struct VenueFormState {
    /// The venue being edited; `None` on New venue.
    pub id: Option<String>,
    pub name: String,
    pub address: Address,
    /// The Seating capacity box, as typed.
    pub seating_capacity: String,
    /// The venue as loaded (Edit venue).
    pub loaded: Option<Location>,
    /// The largest layout's seats while the venue has layouts (spec 038 FR-009).
    pub largest: Option<u64>,
    pub kind: SeatingKind,
    /// New venue › Seated: the lines of the "Standard" layout.
    pub seating: LinesDraft,
    pub layout_refused: Option<LayoutRefused>,
    /// The Backend's refusal, shown with [`refusal_banner`].
    pub error: Option<ApiError>,
    /// The address problems of the last press ("Check the address").
    pub problems: Vec<String>,
    pub busy: bool,
    /// The Time zone select's value; '' (none chosen) only on New venue.
    pub zone_choice: String,
    pub zone_problem: Option<String>,
    /// Whether the venue has events, past included (`None` while unknown: the note shows).
    pub has_events: Option<bool>,
}

impl VenueFormState {
    fn blank(id: Option<String>) -> Self {
        VenueFormState {
            id,
            name: String::new(),
            address: Address::default(),
            seating_capacity: String::new(),
            loaded: None,
            largest: None,
            kind: SeatingKind::General,
            seating: LinesDraft {
                name: FIRST_LAYOUT.into(),
                levels: vec![first_level()],
                lines: Vec::new(),
            },
            layout_refused: None,
            error: None,
            problems: Vec::new(),
            busy: false,
            zone_choice: String::new(),
            zone_problem: None,
            has_events: None,
        }
    }

    /// `/locations/new`.
    pub fn new_venue() -> Self {
        Self::blank(None)
    }

    /// `/locations/{id}/edit`, before anything loaded. Load `GET /locations/{id}`
    /// ([`Self::on_loaded`]), `GET /locations/{id}/layouts` ([`Self::on_layouts`]), and the venue's
    /// events with `includePast` ([`Self::set_has_events`]).
    pub fn edit(id: &str) -> Self {
        Self::blank(Some(id.into()))
    }

    /// `isEdit`.
    pub fn is_edit(&self) -> bool {
        self.id.is_some()
    }

    /// The venue loaded: its name, its parts ('' for a legacy venue's), capacity, and zone.
    pub fn on_loaded(&mut self, l: Location) {
        self.name = l.name.to_string();
        let part = |p: Option<&String>| p.cloned().unwrap_or_default();
        self.address = Address {
            street: part(l.street.as_deref()),
            city: part(l.city.as_deref()),
            state: l.state.map(|s| s.to_string()).unwrap_or_default(),
            zip: part(l.zip.as_deref()),
        };
        self.seating_capacity = l.seating_capacity.to_string();
        self.zone_choice = l.time_zone.to_string();
        self.loaded = Some(l);
    }

    /// The venue could not be loaded: its refusal is shown ("Could not save").
    pub fn on_load_failed(&mut self, error: ApiError) {
        self.error = Some(error);
    }

    /// The venue's layouts loaded: the largest sets the capacity (M7).
    pub fn on_layouts(&mut self, layouts: &[LayoutSummary]) {
        self.largest = largest_capacity(layouts);
    }

    /// The layouts could not be read: the capacity is typed and sent.
    pub fn on_layouts_failed(&mut self) {
        self.largest = None;
    }

    /// Whether the venue has events: `Some(n > 0)` once read, `None` when the read failed.
    pub fn set_has_events(&mut self, has_events: Option<bool>) {
        self.has_events = has_events;
    }

    /// A zone chosen in the select clears its problem.
    pub fn choose_zone(&mut self, zone: &str) {
        self.zone_choice = zone.into();
        self.zone_problem = None;
    }

    /// `setByLayout`: the capacity comes from the largest layout.
    pub fn set_by_layout(&self) -> bool {
        self.largest.is_some()
    }

    /// `legacy`: a venue from before 013, with a one-line address and no parts.
    pub fn legacy(&self) -> bool {
        self.loaded.as_ref().is_some_and(|l| l.street.is_none())
    }

    /// `addressChanged`.
    pub fn address_changed(&self) -> bool {
        !same_as_stored(&self.address, self.loaded.as_ref())
    }

    /// `storedZone`: the loaded venue's zone, else Eastern.
    pub fn stored_zone(&self) -> String {
        self.loaded
            .as_ref()
            .map_or(DEFAULT_TIME_ZONE.to_string(), |l| l.time_zone.to_string())
    }

    /// A required field with no valid value yet is outlined in red at once (`LocationForm.tsx`),
    /// by its control's id.
    pub fn needed(&self, id: &str) -> bool {
        let send = self.send_address();
        match id {
            "name" => js_trim(&self.name).is_empty(),
            "street" => send && js_trim(&self.address.street).is_empty(),
            "city" => send && js_trim(&self.address.city).is_empty(),
            "state" => send && self.address.state.is_empty(),
            "zip" => send && !is_zip(js_trim(&self.address.zip)),
            "timeZone" => !self.is_edit() && self.zone_choice.is_empty(),
            "seatingCapacity" => {
                // `wholeAtLeastOne`: digits only, and not zero.
                let t = js_trim(&self.seating_capacity);
                !(t.bytes().all(|b| b.is_ascii_digit()) && t.bytes().any(|b| b != b'0'))
            }
            _ => false,
        }
    }

    /// `sendAddress` (spec 024 R3): always on create; on edit when the address changed, or when the
    /// loaded (non-legacy) venue's address is not verified, so it is checked again.
    pub fn send_address(&self) -> bool {
        !self.is_edit()
            || self.address_changed()
            || self
                .loaded
                .as_ref()
                .is_some_and(|l| !l.address_verified && l.street.is_some())
    }

    /// `recordsAdminZone` (spec 024 R1, R3): the zone shown goes with the address and will be
    /// recorded as chosen by an admin.
    pub fn records_admin_zone(&self) -> bool {
        self.is_edit()
            && self.loaded.as_ref().is_some_and(|l| {
                self.send_address()
                    && self.zone_choice == self.stored_zone()
                    && l.time_zone_source.to_string() != "ADMIN"
            })
    }

    /// "New venue" / "Edit venue".
    pub fn title(&self) -> &'static str {
        if self.is_edit() {
            "Edit venue"
        } else {
            "New venue"
        }
    }

    /// The submit button's text.
    pub fn submit_label(&self) -> &'static str {
        if self.busy {
            "Saving…"
        } else if self.is_edit() {
            "Save changes"
        } else {
            "Create venue"
        }
    }

    /// The note above the address fields (V9), if any.
    pub fn address_note(&self) -> Option<String> {
        let l = self.loaded.as_ref()?;
        if self.legacy() {
            Some(format!(
                "Current address (not verified): {}. Enter it below to verify it.",
                l.address.as_str()
            ))
        } else if !l.address_verified {
            Some(UNVERIFIED_NOTE.into())
        } else {
            None
        }
    }

    /// The Time zone select's options: "Choose a time zone" on New venue only, then the eight.
    pub fn zone_options(&self) -> Vec<SelectOption> {
        let choose = (!self.is_edit()).then(|| SelectOption {
            value: String::new(),
            label: "Choose a time zone".into(),
        });
        choose
            .into_iter()
            .chain(US_TIME_ZONES.iter().map(|z| SelectOption {
                value: z.id.into(),
                label: z.name.into(),
            }))
            .collect()
    }

    /// `zoneHints` (V8): what is said under the select, in order.
    pub fn zone_hints(&self) -> Vec<ZoneHint> {
        let hint = |id, text: String| ZoneHint {
            id,
            text,
            alert: false,
        };
        let mut out = Vec::new();
        if let Some(problem) = &self.zone_problem {
            out.push(ZoneHint {
                id: "timeZone-problem",
                text: problem.clone(),
                alert: true,
            });
        }
        if !self.is_edit() {
            out.push(hint("timeZone-hint", NEW_ZONE_HINT.into()));
        }
        let stored = self.stored_zone();
        if let Some(l) = &self.loaded {
            out.push(hint("timeZone-stored", format!("{}.", zone_text(l))));
            if self.address_changed() {
                out.push(hint("timeZone-address", ADDRESS_ZONE_HINT.into()));
            }
        }
        if self.records_admin_zone() {
            out.push(hint(
                "timeZone-records",
                format!(
                    "Saving records {} as chosen by an admin.",
                    zone_name(&stored)
                ),
            ));
        }
        if self.loaded.is_some()
            && self.has_events != Some(false)
            && !self.zone_choice.is_empty()
            && self.zone_choice != stored
        {
            out.push(hint("timeZone-change", ZONE_CHANGE_NOTE.into()));
        }
        out
    }

    /// The select's `aria-describedby`: the hints' ids, or none.
    pub fn zone_described_by(&self) -> Option<String> {
        let ids: Vec<&str> = self.zone_hints().iter().map(|h| h.id).collect();
        (!ids.is_empty()).then(|| ids.join(" "))
    }

    /// The select's `aria-invalid`.
    pub fn zone_invalid(&self) -> bool {
        self.zone_problem.is_some()
    }

    /// What stands where Seating capacity goes (V2, M7).
    pub fn capacity_field(&self) -> CapacityField {
        if !self.is_edit() && self.kind == SeatingKind::Seated {
            CapacityField::Lines {
                total: total_text(self.seating.total_seats()),
            }
        } else if let Some(value) = self.largest {
            CapacityField::FromLayouts {
                value,
                hint: capacity_note(value),
            }
        } else {
            CapacityField::Typed
        }
    }

    /// `save` (spec 024 R1, R3, R4; 007 FR-017; 008 R8): one press names every problem (the
    /// address fields and the missing zone) and sends nothing; otherwise it is busy and returns
    /// the request to make. Either way the last refusal and layout banner are cleared.
    pub fn save(&mut self) -> Option<SaveRequest> {
        self.error = None;
        self.layout_refused = None;
        let send_address = self.send_address();
        self.problems = if send_address {
            address_problems(&self.address)
                .into_iter()
                .map(String::from)
                .collect()
        } else {
            Vec::new()
        };
        let missing_zone = !self.is_edit() && self.zone_choice.is_empty();
        self.zone_problem = missing_zone.then(|| ZONE_REQUIRED.to_string());
        if !self.problems.is_empty() || missing_zone {
            return None;
        }

        self.busy = true;
        let seated = !self.is_edit() && self.kind == SeatingKind::Seated;
        let mut body = Map::new();
        body.insert("name".into(), json!(self.name));
        if send_address {
            body.insert("street".into(), json!(self.address.street));
            body.insert("city".into(), json!(self.address.city));
            body.insert("state".into(), json!(self.address.state));
            body.insert("zip".into(), json!(js_trim(&self.address.zip)));
            body.insert("acceptUnverifiedAddress".into(), json!(true));
        }
        if !self.zone_choice.is_empty() && (send_address || self.zone_choice != self.stored_zone())
        {
            body.insert("timeZone".into(), json!(self.zone_choice));
        }
        let capacity = if seated {
            self.seating.total_seats()
        } else {
            js_number(&self.seating_capacity)
        };

        match &self.id {
            Some(id) => {
                if !self.set_by_layout() {
                    body.insert("seatingCapacity".into(), json_number(capacity));
                }
                Some(SaveRequest::Update {
                    id: id.clone(),
                    body: Value::Object(body),
                })
            }
            None => {
                body.insert("seatingCapacity".into(), json_number(capacity));
                Some(SaveRequest::Create {
                    body: Value::Object(body),
                    layout: seated.then(|| self.seating.to_lines_input()),
                })
            }
        }
    }

    /// The save went through (and, for a seated venue, its layout): go to `/locations` with this
    /// notice.
    pub fn on_saved(&mut self, venue: &Location) -> Notice {
        self.busy = false;
        saved_notice(venue)
    }

    /// The Backend refused the venue: shown as a banner; every value kept.
    pub fn on_refused(&mut self, error: ApiError) {
        self.error = Some(error);
        self.busy = false;
    }

    /// The venue was created but its layout refused: the form stays, with the banner.
    pub fn on_layout_refused(&mut self, venue: &Location, error: ApiError) {
        let id = venue.id.to_string();
        self.layout_refused = Some(LayoutRefused {
            href: format!("/locations/{id}"),
            venue_id: id,
            message: error.message().to_string(),
            not_verified: (!venue.address_verified).then(|| {
                format!(
                    "Its address is saved but not verified: {}. The US address service couldn't confirm it, so check that it's right.",
                    venue.address.as_str()
                )
            }),
        });
        self.busy = false;
    }
}

// ---------------------------------------------------------------- ErrorBanner.tsx

/// An event a `TIME_ZONE_HAS_ORDERS` refusal names, shown as a link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventLink {
    pub id: String,
    pub name: String,
}

impl EventLink {
    /// `/events/{id}`.
    pub fn href(&self) -> String {
        format!("/events/{}", self.id)
    }
}

/// What `ErrorBanner` shows for a refusal (FR-036: branched on the code, never the message).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefusalBanner {
    /// `data-code`.
    pub code: Option<String>,
    /// `SCHEDULING_CONFLICT`: `banner--conflict` and ◆; otherwise `banner--error` and ✕.
    pub conflict: bool,
    /// "Venue already committed" for a conflict, else the given title or "Could not save".
    pub title: String,
    pub message: String,
    /// `details.fields`, one item each.
    pub fields: Vec<String>,
    /// `TIME_ZONE_HAS_ORDERS`' `details.events`, as links.
    pub events: Vec<EventLink>,
    /// `ADDRESS_AMBIGUOUS`' `details.candidates`.
    pub candidates: Vec<String>,
}

/// `ErrorBanner` (`admin-app/src/components/ErrorBanner.tsx`): a refusal as a banner, with its
/// fields, events, and candidates. `title` overrides "Could not save".
pub fn refusal_banner(error: &ApiError, title: Option<&str>) -> RefusalBanner {
    let code = error.code().map(str::to_string);
    let conflict = code.as_deref() == Some("SCHEDULING_CONFLICT");
    let details = error.details();
    let strings = |key: &str| -> Vec<String> {
        details
            .and_then(|d| d.get(key))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let events = if code.as_deref() == Some("TIME_ZONE_HAS_ORDERS") {
        details
            .and_then(|d| d.get("events"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|e| EventLink {
                        id: e["id"].as_str().unwrap_or_default().into(),
                        name: e["name"].as_str().unwrap_or_default().into(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    RefusalBanner {
        conflict,
        title: if conflict {
            "Venue already committed".into()
        } else {
            title.unwrap_or("Could not save").into()
        },
        message: error.message().into(),
        fields: error.fields(),
        events,
        candidates: strings("candidates"),
        code,
    }
}

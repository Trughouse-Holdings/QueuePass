//! Spec 037 T048 (parity E2–E8, E15, E16, M8–M11): the event form's rules, ported from
//! `admin-app/src/pages/event-form-checks.ts`, the pure logic of `EventForm.tsx`,
//! `event-form-times.ts`, `DateTimeFields.tsx`, and `components/SeatingSection.tsx`. Each case is
//! one of `admin-app/test/event-form-checks.test.ts`, `event-form-flow.test.tsx`,
//! `event-doors-open.test.tsx`, `capacity.test.tsx`, `event-types-edit.test.tsx`,
//! `event-create-atomic.test.tsx`, `EventForm.conflict.test.tsx`, `ticket-limit.test.tsx`,
//! `seating-section.test.tsx`, and `event-seating-create.test.tsx`, played on the form's state
//! instead of its markup. Every request body is checked against `contracts/openapi.yaml`.

#[path = "fixtures/event/layouts.rs"]
mod fixtures;

use std::collections::BTreeSet;
use std::sync::LazyLock;

use admin_rust_core::api::client::{ApiError, error_from};
use admin_rust_core::forms::event::{
    self, Availability, CONFLICT_PREFIX, EventFormState, EventLoad, EventSeating, FieldMessages,
    LevelPreview, MSG_BAD_PRICE, MSG_END_ORDER, MSG_NAME, MSG_NO_SEAT_ON_SALE, MSG_TYPE_QUANTITY,
    Occurrence, PreviewInput, SeatingPreview, SectionRequest, Submit, TicketType, Tier, TimeField,
    TimeNote, TypeField, Venue, field_errors, lock_reason, over_capacity_message, preview_errors,
    repeated_type_name_message, seat_totals,
};
use admin_rust_core::forms::off_sale::{LayoutDetail, LayoutSectionSeats, LayoutSummary, Taken};
use admin_rust_core::time::{
    DoorsMode, ResolvedLocal, doors_open_range_message, parse_instant, resolve_local,
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use fixtures::{EVENT_ID, VENUE_ID};

// ---------------------------------------------------------------- the contract

static COMPONENTS: LazyLock<Value> = LazyLock::new(|| {
    let text = include_str!("../../../contracts/openapi.yaml");
    let doc: Value = serde_yaml::from_str(text).expect("parse the contract");
    doc["components"].clone()
});

/// Checks `body` against `components.schemas.<name>`, with `components` attached so `$ref`s
/// resolve.
fn conforms(name: &str, body: &Value) {
    let schema = json!({
        "$ref": format!("#/components/schemas/{name}"),
        "components": *COMPONENTS,
    });
    let validator = jsonschema::validator_for(&schema).expect("a valid schema");
    let errors: Vec<String> = validator.iter_errors(body).map(|e| e.to_string()).collect();
    assert!(errors.is_empty(), "{name}: {errors:?} in {body}");
}

#[test]
fn the_contract_check_refuses_what_the_contract_refuses() {
    for (name, body) in [
        ("EventInput", json!({ "name": "x" })),
        ("EventUpdate", json!({})),
        ("EventUpdate", json!({ "tiers": null })),
        ("EventTierInput", json!({ "name": "x", "price": "1.999" })),
        ("OffSaleSelector", json!({ "sectionId": "s", "row": 0 })),
        (
            "LevelPriceInput",
            json!({ "levelId": "l", "price": "1", "extra": 1 }),
        ),
    ] {
        let schema = json!({
            "$ref": format!("#/components/schemas/{name}"),
            "components": *COMPONENTS,
        });
        let validator = jsonschema::validator_for(&schema).unwrap();
        assert!(!validator.is_valid(&body), "{name} accepted {body}");
    }
}

/// A create body: `EventInput`, and each of its tiers, level prices, and selectors.
fn create_conforms(body: &Value) {
    conforms("EventInput", body);
    parts_conform(body);
}

fn update_conforms(body: &Value) {
    conforms("EventUpdate", body);
    parts_conform(body);
}

fn parts_conform(body: &Value) {
    for (field, schema) in [
        ("tiers", "EventTierInput"),
        ("levelPrices", "LevelPriceInput"),
        ("offSale", "OffSaleSelector"),
    ] {
        for item in body[field].as_array().into_iter().flatten() {
            conforms(schema, item);
        }
    }
}

// ---------------------------------------------------------------- the form, as the tests drive it

type Form = EventFormState;

fn now() -> DateTime<Utc> {
    parse_instant("2026-11-15T15:20:00Z").unwrap()
}

fn venue(v: Value) -> Venue {
    serde_json::from_value(v).unwrap()
}

fn layouts(list: &[Value]) -> Vec<LayoutSummary> {
    list.iter()
        .map(|v| serde_json::from_value(v.clone()).unwrap())
        .collect()
}

fn detail(v: Value) -> LayoutDetail {
    serde_json::from_value(v).unwrap()
}

fn seats(id: &str) -> LayoutSectionSeats {
    serde_json::from_value(fixtures::section_by_id(id)).unwrap()
}

fn refusal(status: u16, body: Value) -> ApiError {
    ApiError::Status(error_from(status, body.to_string().as_bytes()))
}

fn refused(status: u16, code: &str, message: &str, details: Option<Value>) -> ApiError {
    let mut error = json!({ "code": code, "message": message });
    if let Some(d) = details {
        error["details"] = d;
    }
    refusal(status, json!({ "error": error }))
}

fn validation(fields: &[&str]) -> ApiError {
    refused(
        400,
        "VALIDATION_FAILED",
        "Request validation failed.",
        Some(json!({ "fields": fields })),
    )
}

/// A new form at `venues`.
fn new_form(venues: Vec<Value>) -> Form {
    let mut f = Form::new_event(now());
    f.venues_loaded(venues.into_iter().map(venue).collect());
    f
}

/// `setLocalDateTime`: the date control, then the time control.
fn set_local(f: &mut Form, field: TimeField, value: &str) {
    let (date, time) = value.split_once('T').unwrap_or((value, ""));
    f.set_date(field, date);
    f.set_time(field, time);
}

/// The doors test's `set('Doors open', value)`: At a set time first, then the two controls.
fn set_doors(f: &mut Form, value: &str) {
    f.switch_doors_mode(DoorsMode::AtTime);
    set_local(f, TimeField::DoorsOpenAt, value);
}

fn type_line(f: &mut Form, i: usize, name: &str, price: &str, quantity: Option<&str>) {
    f.set_type(i, TypeField::Name, name);
    f.set_type(i, TypeField::Price, price);
    if let Some(q) = quantity {
        f.set_type(i, TypeField::Quantity, q);
    }
}

fn create_body(f: &mut Form) -> Value {
    match f.submit() {
        Submit::Create(body) => {
            create_conforms(&body);
            body
        }
        other => panic!("expected a create, got {other:?}"),
    }
}

fn update_body(f: &mut Form) -> Value {
    match f.submit() {
        Submit::Update { event_id, body } => {
            assert_eq!(event_id, EVENT_ID);
            update_conforms(&body);
            body
        }
        other => panic!("expected an update, got {other:?}"),
    }
}

fn invalid_focus(f: &mut Form) -> String {
    match f.submit() {
        Submit::Invalid { focus } => focus.expect("a field to focus"),
        other => panic!("expected nothing sent, got {other:?}"),
    }
}

fn local_of(f: &Form, field: TimeField) -> String {
    f.time(field).value.clone()
}

fn assert_local(f: &Form, field: TimeField, value: &str) {
    let (date, time) = value.split_once('T').unwrap();
    let input = f.time(field);
    assert_eq!((input.date.as_str(), input.time.as_str()), (date, time));
    assert_eq!(input.value, value);
}

fn has_key(body: &Value, key: &str) -> bool {
    body.as_object().unwrap().contains_key(key)
}

// ---------------------------------------------------------------- event-form-checks.test.ts

fn ga(name: &str, price: &str, quantity: &str) -> TicketType {
    TicketType {
        id: None,
        name: name.into(),
        price: price.into(),
        quantity: quantity.into(),
    }
}

struct Base {
    name: String,
    starts: String,
    ends: String,
    doors: String,
    types: Vec<TicketType>,
    seating: Option<SeatingPreview>,
    total: String,
    limit: String,
}

impl Base {
    fn new() -> Self {
        Self {
            name: "Season Opener".into(),
            starts: "2030-05-01T18:00".into(),
            ends: "2030-05-01T21:00".into(),
            doors: "2030-05-01T17:00".into(),
            types: vec![ga("Floor", "80.00", "80")],
            seating: None,
            total: "100".into(),
            limit: String::new(),
        }
    }

    fn errors(&self) -> FieldMessages {
        preview_errors(&PreviewInput {
            name: &self.name,
            location_id: "v-plain",
            starts_at: &self.starts,
            ends_at: &self.ends,
            doors_open_at: &self.doors,
            venue_zone: "America/New_York",
            has_venue: true,
            occurrence: Default::default(),
            types_loaded: true,
            types: &self.types,
            seating: self.seating.as_ref(),
            total_ticket_capacity: &self.total,
            venue_capacity: Some(100),
            max_per_customer: &self.limit,
            doors_from_start: false,
        })
    }
}

fn name_taken() -> String {
    repeated_type_name_message(1, "floor", 0, "Floor")
}

#[test]
fn checks_flag_an_empty_name_and_clear_when_it_is_filled() {
    let mut b = Base::new();
    b.name = "  ".into();
    assert_eq!(b.errors().get("name"), Some(MSG_NAME));
    assert!(!Base::new().errors().has("name"));
}

#[test]
fn checks_flag_a_bad_price_and_clear_when_it_is_fixed() {
    let mut b = Base::new();
    b.types = vec![ga("Floor", "8.999", "80")];
    assert_eq!(b.errors().get("tiers.0.price"), Some(MSG_BAD_PRICE));
    b.types = vec![ga("Floor", "8.99", "80")];
    assert!(!b.errors().has("tiers.0.price"));
}

#[test]
fn checks_use_the_031_wording_for_a_repeated_type_name_on_the_later_type() {
    let mut b = Base::new();
    b.types = vec![ga("Floor", "80.00", "40"), ga("floor", "60.00", "40")];
    let errors = b.errors();
    assert_eq!(errors.get("tiers.1.name"), Some(name_taken().as_str()));
    assert!(!errors.has("tiers.0.name"));
    assert_eq!(
        name_taken(),
        "Ticket type 2, 'floor', has the same name as ticket type 1, 'Floor'. Give each ticket type its own name."
    );
}

#[test]
fn checks_flag_an_end_before_the_start_and_doors_out_of_range() {
    let mut b = Base::new();
    b.starts = "2030-05-01T21:00".into();
    b.ends = "2030-05-01T18:00".into();
    assert_eq!(b.errors().get("endsAt"), Some(MSG_END_ORDER));
    let mut b = Base::new();
    b.doors = "2030-05-01T08:00".into();
    assert!(
        b.errors()
            .get("doorsOpenAt")
            .unwrap()
            .starts_with("Doors must open no more than 6 hours")
    );
}

#[test]
fn checks_flag_quantities_over_capacity_and_a_limit_outside_1_to_the_capacity() {
    let mut b = Base::new();
    b.types = vec![ga("Floor", "80.00", "120")];
    assert_eq!(
        b.errors().get("tiers"),
        Some(over_capacity_message("Season Opener", 100, 120).as_str())
    );
    assert_eq!(
        over_capacity_message(" ", 100, 120),
        "This event has 100 tickets, but its ticket types add up to 120."
    );
    let mut b = Base::new();
    b.limit = "200".into();
    assert!(
        b.errors()
            .get("maxTicketsPerCustomer")
            .unwrap()
            .contains("from 1 to 100")
    );
    b.limit = "4".into();
    assert!(!b.errors().has("maxTicketsPerCustomer"));
}

#[test]
fn checks_flag_each_missing_or_malformed_type_field() {
    let mut b = Base::new();
    b.types = vec![ga("", "", ""), ga("Lawn", "1", "0"), ga("Box", "1", "abc")];
    let e = b.errors();
    assert_eq!(e.get("tiers.0.name"), Some("Give this ticket type a name."));
    assert_eq!(
        e.get("tiers.0.price"),
        Some("Give this ticket type a price.")
    );
    assert_eq!(e.get("tiers.0.quantity"), Some(MSG_TYPE_QUANTITY));
    assert_eq!(
        e.get("tiers.1.quantity"),
        Some("quantity must be a positive whole number")
    );
    assert!(e.has("tiers.2.quantity"));
}

#[test]
fn checks_of_times_run_only_with_a_venue_and_name_each_problem() {
    let types = vec![ga("Floor", "80.00", "80")];
    let input = |starts: &str, ends: &str, doors: &str, has_venue: bool| {
        preview_errors(&PreviewInput {
            name: "X",
            location_id: if has_venue { "v" } else { "" },
            starts_at: starts,
            ends_at: ends,
            doors_open_at: doors,
            venue_zone: "America/New_York",
            has_venue,
            occurrence: Default::default(),
            types_loaded: true,
            types: &types,
            seating: None,
            total_ticket_capacity: "",
            venue_capacity: None,
            max_per_customer: "",
            doors_from_start: true,
        })
    };
    let none = input("", "", "", false);
    assert_eq!(
        none.get("locationId"),
        Some("Choose a venue first: times are in the venue's local time.")
    );
    assert!(!none.has("startsAt"));
    let empty = input("", "", "", true);
    assert_eq!(empty.get("startsAt"), Some("Enter when the event starts."));
    assert_eq!(empty.get("endsAt"), Some("Enter when the event ends."));
    // Doors from the start: a start that names no moment is the start's problem only.
    assert!(!empty.has("doorsOpenAt"));
    let bad = input("2030-13-01T18:00", "nonsense", "2030-05-01T17:00", true);
    assert_eq!(bad.get("startsAt"), Some("Enter when the event starts."));
    assert_eq!(bad.get("endsAt"), Some("Enter when the event ends."));
    let skipped = input(
        "2027-03-14T02:30",
        "2027-03-14T05:00",
        "2027-03-14T01:00",
        true,
    );
    assert_eq!(
        skipped.get("startsAt"),
        Some(
            "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time."
        )
    );
    let repeated = input(
        "2027-11-07T01:30",
        "2027-11-07T05:00",
        "2027-11-07T01:00",
        true,
    );
    assert_eq!(
        repeated.get("startsAt"),
        Some("Choose which 1:30 AM you mean.")
    );
    // The limit, with no capacity known.
    let mut b = Base::new();
    b.limit = "0".into();
    b.total = String::new();
    let e = preview_errors(&PreviewInput {
        venue_capacity: None,
        ..PreviewInput {
            name: &b.name,
            location_id: "v",
            starts_at: &b.starts,
            ends_at: &b.ends,
            doors_open_at: &b.doors,
            venue_zone: "America/New_York",
            has_venue: true,
            occurrence: Default::default(),
            types_loaded: true,
            types: &b.types,
            seating: None,
            total_ticket_capacity: &b.total,
            venue_capacity: Some(1),
            max_per_customer: &b.limit,
            doors_from_start: false,
        }
    });
    assert_eq!(
        e.get("maxTicketsPerCustomer"),
        Some("Tickets per customer must be a whole number of at least 1, or blank for no limit.")
    );
}

fn seating_preview(on_sale: i64, levels: Vec<LevelPreview>) -> SeatingPreview {
    SeatingPreview {
        seats_on_sale: on_sale,
        levels,
    }
}

fn lp(id: &str, name: &str, on_sale: i64, price: &str) -> LevelPreview {
    LevelPreview {
        id: id.into(),
        name: name.into(),
        on_sale,
        price: price.into(),
    }
}

fn arena_levels() -> Vec<LevelPreview> {
    vec![
        lp("l-front", "Front", 30, "95.00"),
        lp("l-back", "Back", 30, ""),
        lp("l-upper", "Upper", 0, ""),
    ]
}

#[test]
fn seated_checks_ask_a_price_of_each_level_with_seats_on_sale_only() {
    let mut b = Base::new();
    b.seating = Some(seating_preview(60, arena_levels()));
    let e = b.errors();
    assert_eq!(e.get("levelPrices.l-back"), Some("Give Back a price."));
    assert!(!e.has("levelPrices.l-front"));
    assert!(!e.has("levelPrices.l-upper"));
    b.seating = Some(seating_preview(
        60,
        vec![lp("l-front", "Front", 60, "9.999")],
    ));
    assert_eq!(b.errors().get("levelPrices.l-front"), Some(MSG_BAD_PRICE));
}

#[test]
fn seated_checks_no_type_refuse_no_seat_on_sale_and_limit_to_the_seats_on_sale() {
    let mut b = Base::new();
    b.types = vec![ga("", "", "")];
    b.seating = Some(seating_preview(0, vec![]));
    b.limit = "1".into();
    let e = b.errors();
    assert!(e.keys().iter().all(|k| !k.starts_with("tiers")));
    assert_eq!(e.get("offSale"), Some(MSG_NO_SEAT_ON_SALE));
    assert!(
        e.get("maxTicketsPerCustomer")
            .unwrap()
            .contains("from 1 to 0")
    );
    let mut b = Base::new();
    b.seating = Some(seating_preview(60, arena_levels()));
    b.limit = "61".into();
    assert!(
        b.errors()
            .get("maxTicketsPerCustomer")
            .unwrap()
            .contains("from 1 to 60")
    );
}

#[test]
fn seat_totals_count_80_of_100_and_name_seats_over_capacity() {
    let under = seat_totals(&[ga("Floor", "80.00", "80")], "100", Some(100));
    assert_eq!(under.summary, "80 of 100 seats assigned");
    assert_eq!(
        under.leftover_sentence.as_deref(),
        Some("20 seats not assigned to a ticket type")
    );
    let over = seat_totals(&[ga("Floor", "80.00", "112")], "100", Some(100));
    assert_eq!(over.over, 12);
    assert_eq!(
        over.leftover_sentence.as_deref(),
        Some("12 seats over the event's capacity")
    );
}

#[test]
fn seat_totals_singular_all_assigned_and_no_capacity() {
    let one = seat_totals(&[ga("", "", "1")], "", None);
    assert_eq!(one.summary, "1 seat assigned");
    assert_eq!(one.leftover_sentence, None);
    assert_eq!(one.per_type[0].name, "Ticket type 1");
    let all = seat_totals(&[ga("A", "1", "1200")], "1200", Some(5));
    assert_eq!(all.summary, "1,200 of 1,200 seats assigned");
    assert_eq!(
        all.leftover_sentence.as_deref(),
        Some("All 1,200 seats are assigned.")
    );
    let left = seat_totals(&[ga("A", "1", "4")], "5", None);
    assert_eq!(
        left.leftover_sentence.as_deref(),
        Some("1 seat not assigned to a ticket type")
    );
    let over = seat_totals(&[ga("A", "1", "6")], "5", None);
    assert_eq!(
        over.leftover_sentence.as_deref(),
        Some("1 seat over the event's capacity")
    );
}

// ---------------------------------------------------------------- order, focus, placement

#[test]
fn field_order_puts_seating_where_the_ticket_types_are() {
    assert_eq!(
        event::field_order(1, &["l-a".into()]),
        [
            "name",
            "locationId",
            "doorsOpenAt",
            "startsAt",
            "endsAt",
            "layoutId",
            "levelPrices.l-a",
            "levelPrices",
            "offSale",
            "tiers.0.name",
            "tiers.0.price",
            "tiers.0.quantity",
            "seating",
            "tiers",
            "totalTicketCapacity",
            "maxTicketsPerCustomer",
        ]
    );
}

#[test]
fn focus_ids_name_the_control() {
    assert_eq!(event::focus_id_for("tiers.1.name"), "type-2-name");
    assert_eq!(event::focus_id_for("levelPrices.l-back"), "price-l-back");
    assert_eq!(event::focus_id_for("seating"), "tickets-and-seating");
    assert_eq!(event::focus_id_for("tiers"), "tickets-and-seating");
    assert_eq!(event::focus_id_for("offSale"), "offSale");
    assert_eq!(event::focus_id_for("levelPrices"), "levelPrices");
}

#[test]
fn first_error_key_falls_back_to_the_first_key_set() {
    let mut e = FieldMessages::default();
    assert_eq!(event::first_error_key(&e, 0, &[]), None);
    e.set("tiers.9.name", "x");
    e.set("weird", "y");
    assert_eq!(
        event::first_error_key(&e, 1, &[]).as_deref(),
        Some("tiers.9.name")
    );
    e.set("endsAt", "z");
    assert_eq!(
        event::first_error_key(&e, 1, &[]).as_deref(),
        Some("endsAt")
    );
    // Set again keeps its place, as a Map does.
    e.set("tiers.9.name", "again");
    assert_eq!(e.keys()[0], "tiers.9.name");
    e.delete("tiers.9.name");
    assert_eq!(e.len(), 2);
}

#[test]
fn visible_errors_show_touched_fields_or_all_after_submit() {
    let mut all = FieldMessages::default();
    all.set("name", "a");
    all.set("endsAt", "b");
    let touched: BTreeSet<String> = ["endsAt".to_string()].into();
    assert_eq!(
        event::visible_errors(&all, &touched, false).keys(),
        ["endsAt"]
    );
    assert_eq!(event::visible_errors(&all, &touched, true).len(), 2);
}

#[test]
fn field_errors_place_each_path() {
    let none = field_errors(None);
    assert!(none.unmapped.is_empty() && none.tiers.is_empty());

    let p = field_errors(Some(&validation(&[
        "tiers.1.price must be a non-negative decimal string with at most 2 decimal places",
        "tiers.tiers must be a list of ticket types, each an object with a name and a price",
        "tiers must be an array",
        "totalTicketCapacity must be a positive whole number",
        "layoutId must be one of the venue's layouts",
        "offSale.0.row must be a whole number of at least 1, and is required with seat",
        "levelPrices.0.price must be a string",
        "endsAt must be later than startsAt",
        "maxTicketsPerCustomer must be from 1 to the event's ticket capacity (40), or empty for no limit",
        "property colour should not exist",
    ])));
    assert_eq!(p.type_errors(1)[0].field, "price");
    assert_eq!(p.tiers.len(), 2);
    assert_eq!(
        p.seating,
        vec!["totalTicketCapacity must be a positive whole number"]
    );
    assert_eq!(p.field("layoutId").unwrap().len(), 1);
    assert_eq!(p.field("offSale").unwrap().len(), 1);
    assert_eq!(p.field("levelPrices").unwrap().len(), 1);
    assert_eq!(
        p.field("endsAt").unwrap(),
        &vec!["endsAt must be later than startsAt".to_string()]
    );
    assert!(p.field("maxTicketsPerCustomer").is_some());
    assert_eq!(p.unmapped, vec!["property colour should not exist"]);

    // `details.field` is the exact path; `tiers` exactly goes beside the ticket types.
    let p = field_errors(Some(&refused(
        409,
        "TIER_HAS_ORDERS",
        "m",
        Some(json!({ "field": "tiers" })),
    )));
    assert_eq!(p.tiers, vec!["m"]);
    let p = field_errors(Some(&refused(
        409,
        "VALIDATION_FAILED",
        "m",
        Some(json!({ "field": "totalTicketCapacity" })),
    )));
    assert_eq!(p.seating, vec!["m"]);
    let p = field_errors(Some(&refused(
        409,
        "VALIDATION_FAILED",
        "m",
        Some(json!({ "field": "name" })),
    )));
    assert_eq!(p.field("name").unwrap(), &vec!["m".to_string()]);
    let p = field_errors(Some(&refused(
        409,
        "VALIDATION_FAILED",
        "m",
        Some(json!({ "field": "somethingElse" })),
    )));
    assert_eq!(p.unmapped, vec!["m"]);
    // A refusal that names its field says it once: `details.fields` is not read then.
    let p = field_errors(Some(&refused(
        400,
        "VALIDATION_FAILED",
        "m",
        Some(json!({ "field": "offSale", "fields": ["offSale.0 again"] })),
    )));
    assert_eq!(p.field("offSale").unwrap(), &vec!["m".to_string()]);
    // DOORS_OPEN_OUT_OF_RANGE without a field goes on the doors; no field, no list: submit.
    let p = field_errors(Some(&refused(
        400,
        "DOORS_OPEN_OUT_OF_RANGE",
        "d",
        Some(json!({})),
    )));
    assert_eq!(p.field("doorsOpenAt").unwrap(), &vec!["d".to_string()]);
    let p = field_errors(Some(&refused(409, "TIER_NAME_TAKEN", "n", None)));
    assert_eq!(p.unmapped, vec!["n"]);
    // `levelPrices` with its levels: each level's box.
    let p = field_errors(Some(&refused(
        400,
        "VALIDATION_FAILED",
        "Give Back a price.",
        Some(
            json!({ "field": "levelPrices", "levels": [{ "levelId": "l-back" }, { "levelId": 3 }] }),
        ),
    )));
    assert_eq!(
        p.field("levelPrices.l-back").unwrap(),
        &vec!["Give Back a price.".to_string()]
    );
    assert_eq!(p.fields.len(), 1);
    // A refusal without an answer is a message by the buttons.
    let p = field_errors(Some(&ApiError::Unreachable));
    assert_eq!(p.unmapped, vec!["The Backend could not be reached."]);
}

#[test]
fn first_placed_key_follows_the_form_order() {
    let p = field_errors(Some(&validation(&[
        "maxTicketsPerCustomer must be from 1",
        "tiers.0.name must be between 1 and 100 characters",
        "totalTicketCapacity must be a positive whole number",
    ])));
    assert_eq!(
        event::first_placed_key(&p, 1, &[]).as_deref(),
        Some("tiers.0.name")
    );
    let p = field_errors(Some(&validation(&[
        "totalTicketCapacity must be a positive whole number",
    ])));
    assert_eq!(
        event::first_placed_key(&p, 1, &[]).as_deref(),
        Some("seating")
    );
    let p = field_errors(Some(&validation(&["tiers must be an array"])));
    assert_eq!(
        event::first_placed_key(&p, 1, &[]).as_deref(),
        Some("tiers")
    );
    let p = field_errors(Some(&validation(&["nothing we know"])));
    assert_eq!(event::first_placed_key(&p, 1, &[]), None);
}

#[test]
fn lock_reasons_read_as_the_react_app_has_them() {
    assert_eq!(
        lock_reason::SEATING,
        "Can't be changed: tickets have been sold."
    );
    assert_eq!(
        lock_reason::LAYOUT,
        "Can't be changed: seats have been sold."
    );
    assert_eq!(
        lock_reason::TYPE,
        "Can't be removed: tickets have been sold."
    );
    assert_eq!(
        lock_reason::quantity(1),
        "This type has 1 ticket already sold."
    );
    assert_eq!(
        lock_reason::quantity(1200),
        "This type has 1,200 tickets already sold."
    );
}

#[test]
fn no_answer_is_a_failed_send_or_a_5xx_without_the_envelope() {
    assert!(event::no_answer_from(&ApiError::Unreachable));
    assert!(event::no_answer_from(&ApiError::Status(error_from(
        502,
        b"<html>Bad Gateway</html>"
    ))));
    assert!(!event::no_answer_from(&refused(
        500,
        "VALIDATION_FAILED",
        "An unexpected error occurred.",
        None
    )));
    assert!(!event::no_answer_from(&ApiError::Status(error_from(
        404, b"nope"
    ))));
    assert!(event::no_answer_from(&ApiError::Decode("x".into())));
}

#[test]
fn base_prices_are_the_lowest_by_cents() {
    assert_eq!(
        event::lowest_price(&[
            ga("Floor", "80.00", "1"),
            ga("Balcony", " 60.00 ", "1"),
            ga("B", "60", "1")
        ]),
        "60.00"
    );
    assert_eq!(
        event::lowest_level_price(&["95.00".into(), "55.00".into(), " ".into()], "1.00"),
        "55.00"
    );
    assert_eq!(event::lowest_level_price(&[], "45.00"), "45.00");
    assert_eq!(event::lowest_level_price(&[" ".into()], ""), "0.00");
}

// ---------------------------------------------------------------- new event times (036 FR-017)

#[test]
fn a_new_event_opens_on_the_next_whole_hour_in_eastern_and_moves_to_the_venues_zone() {
    let mut f = new_form(vec![fixtures::central()]);
    assert_eq!(f.title(), "Schedule event");
    assert_eq!(f.submit_label(), "Schedule event");
    assert_local(&f, TimeField::StartsAt, "2026-11-15T11:00");
    assert_local(&f, TimeField::EndsAt, "2026-11-15T15:00");
    assert_eq!(local_of(&f, TimeField::DoorsOpenAt), "2026-11-15T10:00");
    assert_eq!(f.doors_mode, DoorsMode::Before);
    assert_eq!(f.doors_offset_minutes, Some(60));
    assert_eq!(
        f.zone_line(now()),
        "Choose a venue first: times are in the venue's local time."
    );
    f.choose_venue("v-central", now());
    assert_local(&f, TimeField::StartsAt, "2026-11-15T10:00");
    assert_local(&f, TimeField::EndsAt, "2026-11-15T14:00");
    assert_eq!(local_of(&f, TimeField::DoorsOpenAt), "2026-11-15T09:00");
    assert_eq!(
        f.zone_line(now()),
        "Times are in the venue's time zone: Central Time (CST)."
    );
    // Ends follows the start, 4 hours later, until it is changed.
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T19:00");
    assert_local(&f, TimeField::EndsAt, "2026-11-20T23:00");
    set_local(&mut f, TimeField::EndsAt, "2026-11-20T22:00");
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T18:00");
    assert_local(&f, TimeField::EndsAt, "2026-11-20T22:00");
    // Once a time is changed, another venue keeps every typed time.
    f.choose_venue("v-central", now());
    assert_local(&f, TimeField::StartsAt, "2026-11-20T18:00");
}

#[test]
fn venue_options_and_the_zone_line_with_no_start() {
    let mut f = new_form(vec![fixtures::venue(VENUE_ID, "Yum Center", 22090)]);
    assert_eq!(
        f.venue_options(),
        vec![(
            VENUE_ID.to_string(),
            "Yum Center (22,090 seats)".to_string()
        )]
    );
    f.choose_venue(VENUE_ID, now());
    f.set_time(TimeField::StartsAt, "");
    assert_eq!(
        f.zone_line(now()),
        "Times are in the venue's time zone: Eastern Time (EST)."
    );
    // A repeated start shows its chosen abbreviation, else the first.
    set_local(&mut f, TimeField::StartsAt, "2027-11-07T01:30");
    assert_eq!(
        f.zone_line(now()),
        "Times are in the venue's time zone: Eastern Time (EDT)."
    );
    f.choose_occurrence(TimeField::StartsAt, Occurrence::Second);
    assert_eq!(
        f.zone_line(now()),
        "Times are in the venue's time zone: Eastern Time (EST)."
    );
    // The page.
    assert_eq!(
        event::PAGE_SUB,
        "Events at the same venue must be at least 60 minutes apart."
    );
}

// ---------------------------------------------------------------- event-doors-open.test.tsx

fn central_form() -> Form {
    let mut f = new_form(vec![fixtures::central()]);
    f.choose_venue("v-central", now());
    f.layouts_failed();
    f
}

/// The doors test's `fill`: name, venue, times, and one ticket type.
fn fill(starts: &str, ends: &str) -> Form {
    let mut f = new_form(vec![fixtures::central()]);
    f.set_name("Fall Concert");
    f.choose_venue("v-central", now());
    if starts.is_empty() {
        f.set_date(TimeField::StartsAt, "");
        f.set_time(TimeField::StartsAt, "");
    } else {
        set_local(&mut f, TimeField::StartsAt, starts);
    }
    set_local(&mut f, TimeField::EndsAt, ends);
    f.layouts_failed();
    assert!(f.show_tickets_and_seating());
    type_line(&mut f, 0, "General", "45.00", Some("10"));
    f
}

fn range() -> String {
    doors_open_range_message(
        parse_instant("2026-11-21T01:00:00Z").unwrap(),
        "America/Chicago",
    )
}

#[test]
fn doors_open_before_the_start_1_hour_then_the_line_follows_the_start() {
    let mut f = central_form();
    assert_eq!(f.doors_mode, DoorsMode::Before);
    assert_eq!(f.doors_offset_minutes, Some(60));
    f.set_date(TimeField::StartsAt, "");
    f.set_time(TimeField::StartsAt, "");
    assert_eq!(f.doors_preview(), None);
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T19:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 6:00 PM CST")
    );
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T20:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 7:00 PM CST")
    );
}

#[test]
fn doors_at_a_set_time_stay_when_the_start_changes() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    set_doors(&mut f, "2026-11-20T17:30");
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T20:00");
    assert_local(&f, TimeField::DoorsOpenAt, "2026-11-20T17:30");
    assert_eq!(f.doors_preview(), None);
}

fn stored() -> Value {
    fixtures::with(
        fixtures::event(),
        json!({
            "locationId": "v-central",
            "location": fixtures::central(),
            "startsAt": "2026-11-21T01:00:00.000Z",
            "endsAt": "2026-11-21T04:00:00.000Z",
            "doorsOpenAt": "2026-11-20T23:30:00.000Z",
            "entryOpensAt": "2026-11-20T22:30:00.000Z",
        }),
    )
}

fn edit_form(event: Value, venues: Vec<Value>, tiers: Vec<Value>) -> Form {
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(venues.into_iter().map(venue).collect());
    let load: EventLoad = serde_json::from_value(event).unwrap();
    f.event_loaded(&load, vec![]);
    let tiers: Vec<Tier> = tiers
        .into_iter()
        .map(|t| serde_json::from_value(t).unwrap())
        .collect();
    f.tiers_loaded(&tiers, None, None);
    f.layouts_failed();
    f
}

#[test]
fn doors_on_edit_of_a_90_minute_gap_open_before_the_start_and_keep_the_length() {
    let mut f = edit_form(
        stored(),
        vec![fixtures::central()],
        vec![fixtures::tier("t1", "General", "45.00", 10)],
    );
    assert_eq!(f.title(), "Edit event");
    assert_eq!(f.submit_label(), "Save changes");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 5:30 PM CST")
    );
    assert_eq!(f.doors_mode, DoorsMode::Before);
    assert_eq!(f.doors_offset_minutes, Some(90));
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T20:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 6:30 PM CST")
    );
}

#[test]
fn switching_doors_modes_keeps_the_same_time() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 6:00 PM CST")
    );
    f.switch_doors_mode(DoorsMode::AtTime);
    assert_local(&f, TimeField::DoorsOpenAt, "2026-11-20T18:00");
    f.switch_doors_mode(DoorsMode::Before);
    assert_eq!(f.doors_offset_minutes, Some(60));
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 6:00 PM CST")
    );
}

#[test]
fn doors_do_not_follow_an_unchosen_repeated_start_then_follow_the_chosen_one() {
    let mut f = fill("2027-11-07T03:00", "2027-11-07T05:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 2:00 AM CST")
    );
    set_local(&mut f, TimeField::StartsAt, "2027-11-07T01:30");
    assert_eq!(f.doors_preview(), None);
    assert_eq!(
        f.time_note(TimeField::StartsAt),
        Some(TimeNote::Repeated {
            legend: "Which 1:30 AM?".into(),
            first: "1:30 AM CDT (the first time)".into(),
            second: "1:30 AM CST (the second time)".into(),
            chosen: Occurrence::Unset,
        })
    );
    f.choose_occurrence(TimeField::StartsAt, Occurrence::Second);
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 1:30 AM CDT")
    );
}

#[test]
fn doors_out_of_range_show_the_range_message_and_nothing_is_sent() {
    for value in ["2026-11-20T12:59", "2026-11-20T19:01"] {
        let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
        set_doors(&mut f, value);
        assert_eq!(f.doors_range_note(), Some(range()));
        assert!(!f.doors_range_alert());
        invalid_focus(&mut f);
        assert_eq!(f.doors_range_note(), Some(range()));
        assert!(f.doors_range_alert());
        // The range message is the field's chrome, not repeated as its hint.
        assert!(f.time_field_hint(TimeField::DoorsOpenAt).is_empty());
        assert!(f.field_invalid("doorsOpenAt"));
        assert_local(&f, TimeField::DoorsOpenAt, value);
        assert_eq!(f.name, "Fall Concert");
    }
}

#[test]
fn doors_in_range_are_sent_with_the_venue_offset() {
    for (value, sent) in [
        ("2026-11-20T13:00", "2026-11-20T13:00:00-06:00"),
        ("2026-11-20T19:00", "2026-11-20T19:00:00-06:00"),
        ("2026-11-20T17:30", "2026-11-20T17:30:00-06:00"),
    ] {
        let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
        set_doors(&mut f, value);
        assert_eq!(f.doors_range_note(), None);
        let body = create_body(&mut f);
        assert_eq!(body["startsAt"], "2026-11-20T19:00:00-06:00");
        assert_eq!(body["doorsOpenAt"], sent);
        assert!(f.busy);
        assert_eq!(f.submit_label(), "Saving…");
    }
}

#[test]
fn empty_doors_say_enter_when_doors_open() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    f.switch_doors_mode(DoorsMode::AtTime);
    f.set_date(TimeField::DoorsOpenAt, "");
    f.set_time(TimeField::DoorsOpenAt, "");
    assert_eq!(invalid_focus(&mut f), "doorsOpenAt-date");
    assert_eq!(
        f.time_field_hint(TimeField::DoorsOpenAt),
        vec!["Enter when doors open."]
    );
}

#[test]
fn a_skipped_doors_time_shows_020s_message_and_nothing_is_sent() {
    let mut f = fill("2027-03-14T05:00", "2027-03-14T07:00");
    set_doors(&mut f, "2027-03-14T02:30");
    let message = "2:30 AM on Mar 14, 2027 doesn't exist in Central Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time.";
    assert_eq!(
        f.time_note(TimeField::DoorsOpenAt),
        Some(TimeNote::Skipped(message.into()))
    );
    invalid_focus(&mut f);
    assert_eq!(
        f.time_note(TimeField::DoorsOpenAt),
        Some(TimeNote::Skipped(message.into()))
    );
    assert!(f.time_field_hint(TimeField::DoorsOpenAt).is_empty());
}

#[test]
fn a_repeated_doors_time_is_asked_refused_until_chosen_then_sent_with_its_offset() {
    let mut f = fill("2027-11-07T03:00", "2027-11-07T05:00");
    set_doors(&mut f, "2027-11-07T01:30");
    assert!(matches!(
        f.time_note(TimeField::DoorsOpenAt),
        Some(TimeNote::Repeated { .. })
    ));
    invalid_focus(&mut f);
    assert_eq!(
        f.time_field_hint(TimeField::DoorsOpenAt),
        vec!["Choose which 1:30 AM you mean."]
    );
    f.choose_occurrence(TimeField::DoorsOpenAt, Occurrence::Second);
    let body = create_body(&mut f);
    assert_eq!(body["doorsOpenAt"], "2027-11-07T01:30:00-06:00");
}

#[test]
fn the_create_body_carries_the_default_doors() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    let body = create_body(&mut f);
    assert_eq!(body["doorsOpenAt"], "2026-11-20T18:00:00-06:00");
    assert_eq!(body["name"], "Fall Concert");
    assert_eq!(body["locationId"], "v-central");
    assert_eq!(body["endsAt"], "2026-11-20T22:00:00-06:00");
}

#[test]
fn an_edit_body_carries_doors_too() {
    let mut f = edit_form(
        stored(),
        vec![fixtures::central()],
        vec![fixtures::tier("t1", "General", "45.00", 10)],
    );
    assert_eq!(f.types[0].name, "General");
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T20:00");
    let body = update_body(&mut f);
    assert_eq!(body["startsAt"], "2026-11-20T20:00:00-06:00");
    assert_eq!(body["doorsOpenAt"], "2026-11-20T18:30:00-06:00");
}

#[test]
fn the_backends_doors_out_of_range_goes_on_the_doors_every_value_kept() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    set_doors(&mut f, "2026-11-20T17:30");
    create_body(&mut f);
    let focus = f.create_failed(refused(
        400,
        "DOORS_OPEN_OUT_OF_RANGE",
        &range(),
        Some(json!({})),
    ));
    assert_eq!(focus.as_deref(), Some("doorsOpenAt-date"));
    assert!(!f.busy);
    assert!(!f.times_refusal());
    assert_eq!(f.time_field_hint(TimeField::DoorsOpenAt), vec![range()]);
    assert_local(&f, TimeField::DoorsOpenAt, "2026-11-20T17:30");
    assert_local(&f, TimeField::StartsAt, "2026-11-20T19:00");
}

#[test]
fn doors_follow_to_a_repeated_times_second_occurrence() {
    let f = fill("2027-11-07T02:30", "2027-11-07T04:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 1:30 AM CST")
    );
}

#[test]
fn doors_stay_when_the_start_is_cleared() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    f.set_date(TimeField::StartsAt, "");
    f.set_time(TimeField::StartsAt, "");
    assert_eq!(f.doors_preview(), None);
    f.switch_doors_mode(DoorsMode::AtTime);
    assert_local(&f, TimeField::DoorsOpenAt, "2026-11-20T18:00");
}

#[test]
fn an_edit_without_stored_doors_follows_1_hour_before() {
    let mut old = stored();
    let o = old.as_object_mut().unwrap();
    o.remove("doorsOpenAt");
    o.remove("entryOpensAt");
    let mut f = edit_form(
        old,
        vec![fixtures::central()],
        vec![fixtures::tier("t1", "General", "45.00", 10)],
    );
    assert_local(&f, TimeField::StartsAt, "2026-11-20T19:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 6:00 PM CST")
    );
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T20:00");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 7:00 PM CST")
    );
}

#[test]
fn an_edit_with_a_10_minute_gap_opens_at_a_set_time_and_sends_it() {
    let event = fixtures::with(
        stored(),
        json!({ "doorsOpenAt": "2026-11-21T00:50:00.000Z" }),
    );
    let mut f = edit_form(
        event,
        vec![fixtures::central()],
        vec![fixtures::tier("t1", "General", "45.00", 10)],
    );
    assert_local(&f, TimeField::DoorsOpenAt, "2026-11-20T18:50");
    assert_eq!(f.doors_mode, DoorsMode::AtTime);
    assert_eq!(f.doors_offset_minutes, None);
    let body = update_body(&mut f);
    assert_eq!(body["doorsOpenAt"], "2026-11-20T18:50:00-06:00");
}

#[test]
fn switching_to_before_from_an_off_step_gap_shows_no_length_and_keeps_the_time() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    set_doors(&mut f, "2026-11-20T17:50");
    f.switch_doors_mode(DoorsMode::Before);
    assert_eq!(f.doors_offset_minutes, None);
    let options = f.doors_offset_choices();
    assert_eq!(options[0], (None, "Choose a length…".to_string()));
    assert_eq!(options[1], (Some(0), "At the start".to_string()));
    assert_eq!(options.len(), 26);
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 5:50 PM CST")
    );
    set_local(&mut f, TimeField::StartsAt, "2026-11-20T19:30");
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 5:50 PM CST")
    );
    let body = create_body(&mut f);
    assert_eq!(body["doorsOpenAt"], "2026-11-20T17:50:00-06:00");
}

#[test]
fn switching_back_with_empty_doors_derives_them_from_the_start() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    f.switch_doors_mode(DoorsMode::AtTime);
    f.set_date(TimeField::DoorsOpenAt, "");
    f.set_time(TimeField::DoorsOpenAt, "");
    f.switch_doors_mode(DoorsMode::Before);
    assert_eq!(f.doors_offset_minutes, Some(60));
    assert_eq!(f.doors_offset_choices().len(), 25);
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 6:00 PM CST")
    );
    let body = create_body(&mut f);
    assert_eq!(body["doorsOpenAt"], "2026-11-20T18:00:00-06:00");
}

#[test]
fn switching_back_with_an_unchosen_repeated_doors_time_derives_doors() {
    let mut f = fill("2027-11-07T03:00", "2027-11-07T05:00");
    set_doors(&mut f, "2027-11-07T01:30");
    f.switch_doors_mode(DoorsMode::Before);
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 2:00 AM CST")
    );
    let body = create_body(&mut f);
    assert_eq!(body["doorsOpenAt"], "2027-11-07T02:00:00-06:00");
}

#[test]
fn picking_a_length_sends_the_start_minus_it() {
    for (minutes, sent, line) in [
        (0, "2026-11-20T19:00:00-06:00", "Doors open at 7:00 PM CST"),
        (
            120,
            "2026-11-20T17:00:00-06:00",
            "Doors open at 5:00 PM CST",
        ),
        (
            360,
            "2026-11-20T13:00:00-06:00",
            "Doors open at 1:00 PM CST",
        ),
    ] {
        let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
        f.set_doors_offset(minutes);
        assert_eq!(f.doors_preview().as_deref(), Some(line));
        assert_eq!(f.doors_range_note(), None);
        let body = create_body(&mut f);
        assert_eq!(body["doorsOpenAt"], sent);
    }
}

#[test]
fn a_derived_doors_time_on_a_fall_back_night_keeps_its_own_offset() {
    let mut f = fill("2027-11-07T01:30", "2027-11-07T05:00");
    f.choose_occurrence(TimeField::StartsAt, Occurrence::Second);
    f.switch_doors_mode(DoorsMode::AtTime);
    match f.time_note(TimeField::DoorsOpenAt) {
        Some(TimeNote::Repeated { first, chosen, .. }) => {
            assert_eq!(first, "1:30 AM CDT (the first time)");
            assert_eq!(chosen, Occurrence::First);
        }
        other => panic!("{other:?}"),
    }
    f.switch_doors_mode(DoorsMode::Before);
    let body = create_body(&mut f);
    assert_eq!(body["startsAt"], "2027-11-07T01:30:00-06:00");
    assert_eq!(body["doorsOpenAt"], "2027-11-07T01:30:00-05:00");
}

#[test]
fn the_doors_line_says_the_day_before() {
    let mut f = fill("2026-11-21T02:00", "2026-11-21T05:00");
    f.set_doors_offset(360);
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 8:00 PM CST the day before")
    );
    f.set_doors_offset(60);
    assert_eq!(
        f.doors_preview().as_deref(),
        Some("Doors open at 1:00 AM CST")
    );
}

#[test]
fn clearing_the_time_keeps_the_date() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    f.set_time(TimeField::StartsAt, "");
    assert_eq!(f.time(TimeField::StartsAt).date, "2026-11-20");
    assert_eq!(f.time(TimeField::StartsAt).value, "");
}

#[test]
fn a_missing_start_focuses_its_date_and_a_missing_start_time_its_time() {
    let mut f = fill("", "2026-11-20T22:00");
    assert_eq!(invalid_focus(&mut f), "startsAt-date");
    assert!(f.field_invalid("startsAt"));
    assert_eq!(
        f.time_field_hint(TimeField::StartsAt),
        vec!["Enter when the event starts."]
    );
    f.set_date(TimeField::StartsAt, "2026-11-20");
    assert_eq!(invalid_focus(&mut f), "startsAt-time");
}

#[test]
fn a_backend_doors_refusal_focuses_the_length_or_the_doors_date() {
    let mut f = fill("2026-11-20T19:00", "2026-11-20T22:00");
    create_body(&mut f);
    let focus = f.create_failed(refused(
        400,
        "DOORS_OPEN_OUT_OF_RANGE",
        &range(),
        Some(json!({})),
    ));
    assert_eq!(focus.as_deref(), Some("doorsOpenOffset"));
    assert!(f.field_invalid("doorsOpenAt"));
    assert_eq!(f.time_field_hint(TimeField::DoorsOpenAt), vec![range()]);
    // Any edit clears a Backend refusal.
    f.set_name("Fall Concert 2");
    assert!(f.error.is_none());
    assert!(!f.field_invalid("doorsOpenAt"));
}

// ---------------------------------------------------------------- event-form-flow.test.tsx

fn plain() -> Value {
    fixtures::venue("v-plain", "Plain Hall", 500)
}

fn seated_venue(capacity: u64) -> Value {
    fixtures::venue(VENUE_ID, "Yum Center", capacity)
}

fn venue_layouts() -> Vec<LayoutSummary> {
    layouts(&[fixtures::arena_summary(), fixtures::club_summary()])
}

/// `chooseSeatedVenue`: name, the venue with layouts, times; tickets and seating show.
fn seated_venue_form(capacity: u64, name: &str) -> Form {
    let mut f = new_form(vec![seated_venue(capacity), plain()]);
    f.set_name(name);
    f.choose_venue(VENUE_ID, now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    assert!(!f.show_tickets_and_seating());
    f.layouts_loaded(venue_layouts());
    assert!(f.show_tickets_and_seating());
    f
}

#[test]
fn tickets_and_seating_show_once_a_venue_is_chosen_with_the_live_total() {
    let mut f = new_form(vec![seated_venue(30), plain()]);
    assert!(!f.show_tickets_and_seating());
    f.choose_venue(VENUE_ID, now());
    f.layouts_loaded(venue_layouts());
    assert!(f.show_tickets_and_seating());
    assert_eq!(
        f.seat_total_line(),
        "0 of 30 seats assigned 30 seats not assigned to a ticket type"
    );
    assert_eq!(f.total_placeholder(), "30");
    assert_eq!(
        f.total_hint(),
        "Up to 30 at Yum Center. Leave blank to use the venue's capacity."
    );
}

#[test]
fn an_empty_name_is_shown_beside_the_field_nothing_sent_and_focused() {
    let mut f = seated_venue_form(30, "Full House");
    f.set_name("");
    assert_eq!(invalid_focus(&mut f), "name");
    assert_eq!(f.field_hint("name"), vec![MSG_NAME]);
    assert!(f.field_invalid("name"));
}

#[test]
fn a_repeated_type_name_shows_beside_type_2_and_nothing_is_sent() {
    let mut f = seated_venue_form(30, "Full House");
    type_line(&mut f, 0, "Floor", "80.00", Some("10"));
    f.add_type();
    type_line(&mut f, 1, "floor", "60.00", Some("10"));
    assert_eq!(invalid_focus(&mut f), "type-2-name");
    assert_eq!(f.type_hint(1), vec![name_taken()]);
    assert!(f.type_invalid(1, TypeField::Name));
    assert!(!f.type_invalid(0, TypeField::Name));
}

#[test]
fn a_refusal_naming_tiers_1_name_goes_beside_it_and_is_focused() {
    let mut f = seated_venue_form(30, "Full House");
    type_line(&mut f, 0, "Floor", "80.00", Some("10"));
    f.add_type();
    type_line(&mut f, 1, "Balcony", "60.00", Some("20"));
    create_body(&mut f);
    let focus = f.create_failed(refused(
        409,
        "TIER_NAME_TAKEN",
        &name_taken(),
        Some(json!({ "field": "tiers.1.name" })),
    ));
    assert_eq!(focus.as_deref(), Some("type-2-name"));
    assert_eq!(f.type_hint(1), vec![name_taken()]);
    assert!(f.type_invalid(1, TypeField::Name));
    assert_eq!(f.submit_error(), None);
    assert!(!f.times_refusal());
}

fn conflict() -> ApiError {
    refused(
        409,
        "SCHEDULING_CONFLICT",
        "This venue is already committed from 22:00 to 01:00 UTC by 'Season Opener'. Events at the same venue must be at least 60 minutes apart.",
        Some(json!({
            "bufferMinutes": 60,
            "conflictingEvent": {
                "id": "22222222-2222-4222-8222-222222222222",
                "name": "Season Opener",
                "startsAt": "2030-05-01T22:00:00.000Z",
                "endsAt": "2030-05-02T01:00:00.000Z",
            },
        })),
    )
}

#[test]
fn a_scheduling_conflict_shows_with_the_times() {
    let mut f = seated_venue_form(30, "Full House");
    type_line(&mut f, 0, "Floor", "80.00", Some("10"));
    create_body(&mut f);
    assert_eq!(f.create_failed(conflict()), None);
    assert!(f.times_refusal());
    assert_eq!(f.submit_error(), None);
    assert_eq!(
        f.conflict_line().as_deref(),
        Some(
            "Conflicts with Season Opener, which runs May 1, 2030, 6:00 PM EDT – 9:00 PM EDT. Pick a slot at least 60 minutes clear of it, or choose another venue."
        )
    );
    assert!(!f.saved);
}

fn ga_event() -> Value {
    fixtures::with(
        fixtures::event(),
        json!({ "layoutId": null, "priceMax": null, "totalTicketCapacity": 30 }),
    )
}

fn ga_seating() -> EventSeating {
    serde_json::from_value(json!({
        "eventId": EVENT_ID,
        "layoutId": null,
        "levels": [],
        "offSale": [],
        "seatsOnSale": 0,
        "seatsOffSale": 0,
    }))
    .unwrap()
}

fn availability(left: i64, tiers: Value) -> Availability {
    serde_json::from_value(json!({
        "eventId": EVENT_ID,
        "ticketsLeft": left,
        "salesClosed": null,
        "tiers": tiers,
    }))
    .unwrap()
}

fn two_tiers() -> Vec<Tier> {
    [
        fixtures::tier("t-floor", "Floor", "80.00", 10),
        fixtures::tier("t-bal", "Balcony", "30.00", 20),
    ]
    .into_iter()
    .map(|t| serde_json::from_value(t).unwrap())
    .collect()
}

fn ga_edit_with_sales() -> Form {
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(seated_venue(30))]);
    f.event_loaded(&serde_json::from_value(ga_event()).unwrap(), vec![]);
    f.tiers_loaded(
        &two_tiers(),
        Some(&ga_seating()),
        Some(&availability(
            27,
            json!([{ "tierId": "t-floor", "ticketsLeft": 7 }, { "tierId": "t-bal", "ticketsLeft": 20 }]),
        )),
    );
    f.layouts_loaded(venue_layouts());
    f
}

#[test]
fn an_edit_locks_the_seating_and_remove_on_a_type_with_sales() {
    let f = ga_edit_with_sales();
    assert_eq!(f.types[1].name, "Balcony");
    assert!(f.show_seating_select());
    assert_eq!(f.layout_lock_reason(), Some(lock_reason::SEATING));
    assert_eq!(f.remove_type_title(0), Some(lock_reason::TYPE));
    assert_eq!(f.type_sold_hint(0), Some(lock_reason::quantity(3)));
    assert_eq!(f.remove_type_title(1), None);
    assert_eq!(f.type_sold_hint(1), None);
    assert_eq!(f.sold.event_sold, 3);
}

#[test]
fn an_edit_sends_one_patch_with_tiers_and_their_ids_and_no_seating() {
    let mut f = ga_edit_with_sales();
    f.set_type(1, TypeField::Price, "35.00");
    let body = update_body(&mut f);
    assert_eq!(
        body["tiers"],
        json!([
            { "id": "t-floor", "name": "Floor", "price": "80.00", "quantity": 10 },
            { "id": "t-bal", "name": "Balcony", "price": "35.00", "quantity": 20 },
        ])
    );
    for field in ["reservedSeating", "layoutId", "levelPrices", "offSale"] {
        assert!(!has_key(&body, field), "{field}");
    }
    assert_eq!(body["maxTicketsPerCustomer"], Value::Null);
    assert_eq!(body["totalTicketCapacity"], 30);
    f.updated();
    f.finished();
    assert!(f.saved);
    assert_eq!(event::SAVED_MESSAGE, "Event saved.");
    assert_eq!(event::NAVIGATE_AFTER_MS, 700);
}

// ---------------------------------------------------------------- capacity.test.tsx

#[test]
fn a_blank_total_is_left_out_of_the_create() {
    let mut f = new_form(vec![fixtures::venue(VENUE_ID, "Yum Center", 22090)]);
    f.set_name("Blank");
    f.choose_venue(VENUE_ID, now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    f.layouts_failed();
    type_line(&mut f, 0, "General", "10.00", Some("10"));
    let body = create_body(&mut f);
    assert!(!has_key(&body, "totalTicketCapacity"));
    assert!(!has_key(&body, "maxTicketsPerCustomer"));
}

#[test]
fn a_seated_event_whose_types_could_not_load_saves_details_only_and_never_its_total() {
    let event = fixtures::with(
        fixtures::event(),
        json!({ "reservedSeating": true, "totalTicketCapacity": 70 }),
    );
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(fixtures::venue(VENUE_ID, "Yum Center", 22090))]);
    f.event_loaded(&serde_json::from_value(event).unwrap(), vec![]);
    f.tiers_failed();
    assert!(f.details_only());
    assert!(!f.show_tickets_and_seating());
    assert_eq!(
        f.details_only_note(),
        Some(
            "This event's ticket types or seating could not be loaded, so saving changes only the details above."
        )
    );
    assert_eq!(
        f.details_only_total_note().as_deref(),
        Some("Total tickets: 70, the seats on sale.")
    );
    let body = update_body(&mut f);
    assert!(!has_key(&body, "totalTicketCapacity"));
    assert!(!has_key(&body, "tiers"));
    assert_eq!(body["basePrice"], "45.00");
}

// ---------------------------------------------------------------- event-types-edit.test.tsx

fn plain_form(name: &str) -> Form {
    let mut f = new_form(vec![fixtures::venue("v-plain", "Plain Hall", 22090)]);
    f.set_name(name);
    f.choose_venue("v-plain", now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    f.layouts_loaded(vec![]);
    f
}

#[test]
fn a_general_admission_event_is_priced_by_its_lowest_type() {
    let mut f = plain_form("Fair");
    assert!(!f.show_seating_select());
    type_line(&mut f, 0, "Floor", "80.00", Some("100"));
    f.add_type();
    type_line(&mut f, 1, "Lawn", "25.00", Some("300"));
    let body = create_body(&mut f);
    assert_eq!(body["basePrice"], "25.00");
    assert_eq!(
        body["tiers"],
        json!([
            { "name": "Floor", "price": "80.00", "quantity": 100 },
            { "name": "Lawn", "price": "25.00", "quantity": 300 },
        ])
    );
}

#[test]
fn a_general_admission_type_needs_a_quantity() {
    let mut f = new_form(vec![fixtures::venue("v-plain", "Plain Hall", 22090)]);
    f.choose_venue("v-plain", now());
    f.layouts_loaded(vec![]);
    type_line(&mut f, 0, "Floor", "80.00", None);
    invalid_focus(&mut f);
    assert_eq!(
        f.type_hint(0).last().map(String::as_str),
        Some(MSG_TYPE_QUANTITY)
    );
}

fn ga_edit(extra_tiers: Option<Vec<Tier>>) -> Form {
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(fixtures::venue(VENUE_ID, "Yum Center", 22090))]);
    f.event_loaded(&serde_json::from_value(ga_event()).unwrap(), vec![]);
    f.tiers_loaded(&extra_tiers.unwrap_or_else(two_tiers), None, None);
    f.layouts_loaded(venue_layouts());
    f
}

#[test]
fn an_edit_prefills_its_types_and_applies_renamed_repriced_and_new_ones_in_one_patch() {
    let mut f = ga_edit(None);
    assert_eq!(f.types[0].quantity, "10");
    assert_eq!(f.types[1].price, "30.00");
    type_line(&mut f, 1, "Upper", "35.00", Some("15"));
    f.add_type();
    type_line(&mut f, 2, "Box", "120.00", Some("5"));
    let body = update_body(&mut f);
    assert_eq!(body["basePrice"], "35.00");
    assert_eq!(
        body["tiers"],
        json!([
            { "id": "t-floor", "name": "Floor", "price": "80.00", "quantity": 10 },
            { "id": "t-bal", "name": "Upper", "price": "35.00", "quantity": 15 },
            { "name": "Box", "price": "120.00", "quantity": 5 },
        ])
    );
    assert!(!has_key(&body, "reservedSeating"));
}

fn club_seating() -> EventSeating {
    serde_json::from_value(json!({
        "eventId": EVENT_ID,
        "layoutId": "l-club",
        "levels": [{
            "levelId": "l-club", "name": "Club seats", "rank": 1, "color": "orange",
            "seatCount": 12, "seatsOnSale": 12, "price": "20.00",
        }],
        "offSale": [],
        "seatsOnSale": 12,
        "seatsOffSale": 0,
    }))
    .unwrap()
}

#[test]
fn a_seated_events_edit_has_no_ticket_types_it_is_priced_by_level() {
    let event = fixtures::with(
        fixtures::event(),
        json!({ "reservedSeating": true, "layoutId": "l-club", "priceMax": "20.00", "totalTicketCapacity": 12 }),
    );
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(fixtures::venue(VENUE_ID, "Yum Center", 22090))]);
    f.event_loaded(&serde_json::from_value(event).unwrap(), vec![]);
    f.tiers_loaded(&[], Some(&club_seating()), None);
    f.layouts_loaded(venue_layouts());
    assert!(f.seated());
    assert_eq!(f.needs_layout().as_deref(), Some("l-club"));
    assert_eq!(f.seating_status(), Some(event::LOADING_LAYOUT));
    f.layout_loaded(detail(fixtures::club()));
    assert_eq!(f.needs_layout(), None);
    assert_eq!(f.seating_status(), None);
    let rows = f.level_rows();
    assert_eq!(rows[0].price, "20.00");
    assert!(rows[0].price_box);
    // Edit loads keep the saved prices: no "Prices from" note.
    assert_eq!(f.prices_from_note(), None);
}

#[test]
fn a_refused_type_change_shows_beside_the_ticket_types_and_keeps_the_form() {
    let message = "Cannot remove the tier \"Balcony\": it has 2 orders.";
    let mut f = ga_edit(None);
    f.remove_type(1);
    f.set_type(0, TypeField::Quantity, "30");
    update_body(&mut f);
    let focus = f.save_failed(refused(
        409,
        "TIER_HAS_ORDERS",
        message,
        Some(json!({ "field": "tiers", "orderCount": 2 })),
    ));
    assert_eq!(focus.as_deref(), Some("tickets-and-seating"));
    assert_eq!(f.tiers_hint(), vec![message]);
    assert_eq!(f.types[0].quantity, "30");
    assert_eq!(f.types.len(), 1);
}

// ---------------------------------------------------------------- event-create-atomic.test.tsx

fn fill_general() -> Form {
    let mut f = new_form(vec![seated_venue(70), plain()]);
    f.set_name("Season Opener");
    f.choose_venue("v-plain", now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    f.layouts_loaded(vec![]);
    type_line(&mut f, 0, "Floor", "80.00", Some("300"));
    f.add_type();
    type_line(&mut f, 1, "Balcony", " 60.00 ", Some("200"));
    f
}

fn fill_seated() -> Form {
    let mut f = new_form(vec![seated_venue(70), plain()]);
    f.set_name("Season Opener");
    f.choose_venue(VENUE_ID, now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    f.layouts_loaded(venue_layouts());
    f.choose_layout(Some("l-club"));
    f.layout_loaded(detail(fixtures::club()));
    f.set_level_price("l-club", "20.00");
    f
}

fn expect_general_kept(f: &Form) {
    assert_eq!(f.name, "Season Opener");
    assert_eq!(f.location_id, "v-plain");
    assert_local(f, TimeField::StartsAt, "2030-05-01T18:00");
    assert_local(f, TimeField::EndsAt, "2030-05-01T21:00");
    assert_eq!(f.types[0].name, "Floor");
    assert_eq!(f.types[1].name, "Balcony");
    assert_eq!(f.types[1].price, " 60.00 ");
    assert_eq!(f.types[1].quantity, "200");
}

#[test]
fn a_general_admission_schedule_is_one_post_with_its_types() {
    let mut f = fill_general();
    let body = create_body(&mut f);
    assert_eq!(
        body["tiers"],
        json!([
            { "name": "Floor", "price": "80.00", "quantity": 300 },
            { "name": "Balcony", "price": "60.00", "quantity": 200 },
        ])
    );
    assert!(!has_key(&body, "reservedSeating"));
    assert!(!body.to_string().contains("sectionIds"));
    assert_eq!(body["basePrice"], "60.00");
    f.created(EVENT_ID);
    assert_eq!(f.event_id.as_deref(), Some(EVENT_ID));
}

#[test]
fn a_seated_schedule_sends_its_layout_level_prices_and_seats_off_sale() {
    let mut f = fill_seated();
    let body = create_body(&mut f);
    assert_eq!(body["layoutId"], "l-club");
    assert_eq!(
        body["levelPrices"],
        json!([{ "levelId": "l-club", "price": "20.00" }])
    );
    assert_eq!(body["offSale"], json!([]));
    assert_eq!(body["basePrice"], "20.00");
    for field in ["reservedSeating", "totalTicketCapacity", "tiers"] {
        assert!(!has_key(&body, field), "{field}");
    }
}

#[test]
fn a_refused_seat_shows_beside_the_seats_off_sale() {
    let message = "offSale.0 names no seat of this layout";
    let mut f = fill_seated();
    create_body(&mut f);
    let focus = f.create_failed(validation(&[message]));
    assert_eq!(focus.as_deref(), Some("offSale"));
    assert_eq!(f.field_hint("offSale"), vec![message]);
    assert_eq!(
        f.seating.prices.get("l-club").map(String::as_str),
        Some("20.00")
    );
}

#[test]
fn ticket_types_over_capacity_show_beside_the_ticket_types() {
    let message = "Season Opener has 400 tickets, but its ticket types add up to 500.";
    let mut f = fill_general();
    create_body(&mut f);
    f.create_failed(refused(
        409,
        "CAPACITY_EXCEEDED",
        message,
        Some(json!({ "field": "tiers", "totalTicketCapacity": 400, "tierTotal": 500 })),
    ));
    assert_eq!(f.tiers_hint(), vec![message]);
    assert_eq!(f.submit_error(), None);
}

#[test]
fn scheduling_again_clears_the_preview_and_sends_once() {
    let mut f = fill_general();
    type_line(&mut f, 1, "floor", " 60.00 ", Some("200"));
    invalid_focus(&mut f);
    assert!(f.type_invalid(1, TypeField::Name));
    type_line(&mut f, 1, "Balcony", "60.00", Some("200"));
    create_body(&mut f);
    assert!(!f.type_invalid(1, TypeField::Name));
    assert!(f.type_hint(1).is_empty());
}

#[test]
fn a_refusal_with_no_field_goes_next_to_submit() {
    let message = "Another tier of this event already has that name";
    let mut f = fill_general();
    create_body(&mut f);
    assert_eq!(
        f.create_failed(refused(409, "TIER_NAME_TAKEN", message, None)),
        None
    );
    assert_eq!(f.submit_error().as_deref(), Some(message));
    assert!(!f.type_invalid(0, TypeField::Name) && !f.type_invalid(1, TypeField::Name));
}

#[test]
fn no_answer_says_it_cannot_tell_and_keeps_every_value() {
    for err in [
        ApiError::Unreachable,
        ApiError::Status(error_from(502, b"<html>Bad Gateway</html>")),
    ] {
        let mut f = fill_general();
        create_body(&mut f);
        assert_eq!(f.create_failed(err), None);
        assert!(f.no_answer);
        assert!(!f.busy);
        assert_eq!(f.submit_error(), None);
        assert_eq!(event::NO_ANSWER_TITLE, "Could not save");
        assert_eq!(
            event::NO_ANSWER_TEXT,
            "No answer from QueuePass, so the event may or may not have been scheduled. Check the Events list before scheduling it again."
        );
        expect_general_kept(&f);
        // Trying again clears it.
        create_body(&mut f);
        assert!(!f.no_answer);
    }
}

#[test]
fn a_500_with_the_envelope_is_an_error_not_no_answer() {
    let mut f = fill_general();
    create_body(&mut f);
    f.create_failed(refused(
        500,
        "VALIDATION_FAILED",
        "An unexpected error occurred.",
        None,
    ));
    assert_eq!(
        f.submit_error().as_deref(),
        Some("An unexpected error occurred.")
    );
    assert!(!f.no_answer);
}

#[test]
fn each_path_lands_beside_its_field() {
    let entry = "tiers.1.price must be a non-negative decimal string with at most 2 decimal places";
    let mut f = fill_general();
    create_body(&mut f);
    f.create_failed(validation(&[entry]));
    assert!(f.type_invalid(1, TypeField::Price));
    assert_eq!(f.type_hint(1), vec![entry]);
    assert!(!f.type_invalid(1, TypeField::Name) && !f.type_invalid(1, TypeField::Quantity));
    assert!(!f.type_invalid(0, TypeField::Price));

    let entry = "tiers.0.property colour should not exist";
    let mut f = fill_general();
    create_body(&mut f);
    // No control has this id; focusing it does nothing (quirk kept).
    assert_eq!(
        f.create_failed(validation(&[entry])).as_deref(),
        Some("tiers.0.property")
    );
    for field in [TypeField::Name, TypeField::Price, TypeField::Quantity] {
        assert!(f.type_invalid(0, field));
    }
    assert!(!f.type_invalid(1, TypeField::Name));

    let entry =
        "tiers.tiers must be a list of ticket types, each an object with a name and a price";
    let mut f = fill_general();
    create_body(&mut f);
    f.create_failed(validation(&[entry]));
    assert_eq!(f.tiers_hint(), vec![entry]);
    assert!(f.type_hint(0).is_empty());

    let entry = "totalTicketCapacity must be a positive whole number";
    let mut f = fill_general();
    create_body(&mut f);
    assert_eq!(
        f.create_failed(validation(&[entry])).as_deref(),
        Some("tickets-and-seating")
    );
    assert_eq!(f.seating_hint(), vec![entry]);

    let entry = "layoutId must be one of the venue's layouts";
    let mut f = fill_seated();
    create_body(&mut f);
    assert_eq!(
        f.create_failed(validation(&[entry])).as_deref(),
        Some("layoutId")
    );
    assert_eq!(f.field_hint("layoutId"), vec![entry]);
    assert!(f.field_invalid("layoutId"));

    let entry = "offSale.0.row must be a whole number of at least 1, and is required with seat";
    let mut f = fill_seated();
    create_body(&mut f);
    f.create_failed(validation(&[entry]));
    assert_eq!(f.field_hint("offSale"), vec![entry]);
    assert!(!f.field_invalid("layoutId"));
}

#[test]
fn an_edit_places_refusals_beside_their_fields() {
    let fields = [
        "totalTicketCapacity must be a positive whole number",
        "tiers.0.name must be between 1 and 100 characters",
    ];
    let event = fixtures::with(
        fixtures::event(),
        json!({ "locationId": "v-plain", "location": fixtures::venue("v-plain", "Plain Hall", 500) }),
    );
    let mut f = edit_form(
        event,
        vec![plain()],
        vec![fixtures::tier("t1", "Floor", "80.00", 10)],
    );
    update_body(&mut f);
    assert_eq!(
        f.save_failed(validation(&fields)).as_deref(),
        Some("type-1-name")
    );
    assert_eq!(f.seating_hint(), vec![fields[0]]);
    assert_eq!(f.type_hint(0), vec![fields[1]]);
    assert!(f.type_invalid(0, TypeField::Name));
}

// ---------------------------------------------------------------- EventForm.conflict.test.tsx

fn conflict_form() -> Form {
    let mut f = new_form(vec![fixtures::venue(
        "11111111-1111-4111-8111-111111111111",
        "Yum Center",
        22090,
    )]);
    f.set_name("Clashing Show");
    f.choose_venue("11111111-1111-4111-8111-111111111111", now());
    set_local(&mut f, TimeField::StartsAt, "2026-10-01T20:00");
    set_local(&mut f, TimeField::EndsAt, "2026-10-01T23:00");
    f.layouts_loaded(vec![]);
    f.set_total("500");
    type_line(&mut f, 0, "General", "45.00", Some("500"));
    f
}

#[test]
fn a_conflict_names_the_conflicting_event_and_keeps_every_value() {
    let mut f = conflict_form();
    let body = create_body(&mut f);
    assert_eq!(body["totalTicketCapacity"], 500);
    let err = refused(
        409,
        "SCHEDULING_CONFLICT",
        "This venue is already committed.",
        Some(json!({
            "bufferMinutes": 60,
            "conflictingEvent": {
                "id": "22222222-2222-4222-8222-222222222222",
                "name": "Season Opener",
                "startsAt": "2026-10-01T22:00:00.000Z",
                "endsAt": "2026-10-02T01:00:00.000Z",
            },
        })),
    );
    f.create_failed(err);
    assert!(f.times_refusal());
    assert!(f.conflict_line().unwrap().contains("Season Opener"));
    let (name, rest) = f.conflict_parts().unwrap();
    assert_eq!(name, "Season Opener");
    assert!(rest.starts_with(", which runs "));
    assert!(
        rest.ends_with(". Pick a slot at least 60 minutes clear of it, or choose another venue.")
    );
    assert_eq!(
        f.conflict_line().unwrap(),
        format!("{CONFLICT_PREFIX}{name}{rest}")
    );
    assert_eq!(f.name, "Clashing Show");
    assert_local(&f, TimeField::StartsAt, "2026-10-01T20:00");
    assert_local(&f, TimeField::EndsAt, "2026-10-01T23:00");
    assert_eq!(f.total_ticket_capacity, "500");
    assert_eq!(f.types[0].price, "45.00");
    assert!(!f.saved);
}

#[test]
fn a_validation_failure_is_not_a_conflict() {
    let mut f = conflict_form();
    create_body(&mut f);
    f.create_failed(validation(&["endsAt must be later than startsAt"]));
    assert!(!f.times_refusal());
    assert_eq!(
        f.time_field_hint(TimeField::EndsAt),
        vec!["endsAt must be later than startsAt"]
    );
    assert_eq!(f.conflict_line(), None);
}

#[test]
fn check_in_details_removed_is_shown_with_the_times() {
    let mut f = conflict_form();
    create_body(&mut f);
    f.create_failed(refused(
        409,
        "CHECK_IN_DETAILS_REMOVED",
        "Times are locked.",
        None,
    ));
    assert!(f.times_refusal());
    assert_eq!(f.submit_error(), None);
    assert_eq!(f.conflict_line(), None);
}

// ---------------------------------------------------------------- ticket-limit.test.tsx

fn small_form(total: &str, reserved: bool) -> Form {
    let mut f = new_form(vec![fixtures::venue(VENUE_ID, "Yum Center", 50)]);
    f.set_name("Opener");
    f.choose_venue(VENUE_ID, now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    if reserved {
        f.layouts_loaded(layouts(&[fixtures::club_summary()]));
        f.choose_layout(Some("l-club"));
        f.layout_loaded(detail(fixtures::club()));
        f.set_level_price("l-club", "20.00");
        return f;
    }
    f.layouts_loaded(vec![]);
    type_line(&mut f, 0, "General", "10.00", Some("10"));
    f.set_total(total);
    f
}

fn limit_refusal(n: i64) -> String {
    format!("Tickets per customer must be a whole number from 1 to {n}, or blank for no limit.")
}

#[test]
fn the_limit_is_sent_on_create_when_entered_and_left_out_when_blank() {
    assert_eq!(event::LIMIT_HINT, "Leave blank for no limit.");
    let mut f = small_form("40", false);
    f.set_limit("4");
    let body = create_body(&mut f);
    assert_eq!(body["totalTicketCapacity"], 40);
    assert_eq!(body["maxTicketsPerCustomer"], 4);
    let mut f = small_form("", false);
    assert!(!has_key(&create_body(&mut f), "maxTicketsPerCustomer"));
}

#[test]
fn the_limit_is_prefilled_on_edit_and_sent_as_null_when_cleared() {
    let event = fixtures::with(fixtures::event(), json!({ "maxTicketsPerCustomer": 4 }));
    let mut f = edit_form(
        event,
        vec![fixtures::venue(VENUE_ID, "Yum Center", 22090)],
        vec![],
    );
    assert_eq!(f.max_per_customer, "4");
    f.set_limit("");
    type_line(&mut f, 0, "General", "10.00", Some("10"));
    let body = update_body(&mut f);
    assert_eq!(body["maxTicketsPerCustomer"], Value::Null);
}

#[test]
fn a_limit_above_the_stored_capacity_is_sent_after_choosing_a_larger_layout() {
    let event = fixtures::with(
        fixtures::event(),
        json!({ "totalTicketCapacity": 10, "layoutId": null, "priceMax": null }),
    );
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(fixtures::venue(VENUE_ID, "Yum Center", 22090))]);
    f.event_loaded(&serde_json::from_value(event).unwrap(), vec![]);
    f.tiers_loaded(&[], None, None);
    f.layouts_loaded(layouts(&[fixtures::club_summary()]));
    f.choose_layout(Some("l-club"));
    f.layout_loaded(detail(fixtures::club()));
    f.set_level_price("l-club", "20.00");
    f.set_limit("12");
    let body = update_body(&mut f);
    assert_eq!(body["layoutId"], "l-club");
    assert_eq!(body["maxTicketsPerCustomer"], 12);
    assert!(!has_key(&body, "tiers"));
}

#[test]
fn a_limit_out_of_range_is_refused_before_sending() {
    for value in ["0", "2.5", "41"] {
        let mut f = small_form("40", false);
        f.set_limit(value);
        assert_eq!(invalid_focus(&mut f), "maxTicketsPerCustomer");
        assert_eq!(
            f.field_hint("maxTicketsPerCustomer"),
            vec![limit_refusal(40)]
        );
        assert_eq!(f.name, "Opener");
        assert_eq!(f.total_ticket_capacity, "40");
    }
    let mut f = small_form("", false);
    f.set_limit("51");
    invalid_focus(&mut f);
    assert_eq!(
        f.field_hint("maxTicketsPerCustomer"),
        vec![limit_refusal(50)]
    );
    let mut f = small_form("", true);
    f.set_limit("13");
    invalid_focus(&mut f);
    assert_eq!(
        f.field_hint("maxTicketsPerCustomer"),
        vec![limit_refusal(12)]
    );
    f.set_limit("12");
    assert_eq!(create_body(&mut f)["maxTicketsPerCustomer"], 12);
    // Odd numbers as `Number` reads them: "1e1" is 10, "abc" is not a number.
    let mut f = small_form("40", false);
    f.set_limit("1e1");
    assert_eq!(create_body(&mut f)["maxTicketsPerCustomer"], 10);
    let mut f = small_form("40", false);
    f.set_limit("abc");
    assert_eq!(invalid_focus(&mut f), "maxTicketsPerCustomer");
}

#[test]
fn the_browsers_invalid_bubble_is_replaced_by_the_forms_check() {
    let mut f = small_form("40", false);
    f.limit_invalid();
    assert!(f.submitted);
    assert!(f.touched.contains("maxTicketsPerCustomer"));
}

#[test]
fn the_backends_limit_refusal_goes_under_the_field() {
    let mut f = small_form("40", false);
    f.set_limit("4");
    create_body(&mut f);
    f.create_failed(validation(&[
        "maxTicketsPerCustomer must be from 1 to the event's ticket capacity (40), or empty for no limit",
    ]));
    assert!(
        f.field_hint("maxTicketsPerCustomer")[0]
            .starts_with("maxTicketsPerCustomer must be from 1")
    );
    assert_eq!(f.max_per_customer, "4");
    assert_eq!(f.submit_error(), None);
}

// ---------------------------------------------------------------- seating-section.test.tsx

fn arena_form() -> Form {
    let mut f = new_form(vec![seated_venue(70)]);
    f.set_name("Cardinals vs. Duke");
    f.choose_venue(VENUE_ID, now());
    set_local(&mut f, TimeField::StartsAt, "2030-05-01T18:00");
    set_local(&mut f, TimeField::EndsAt, "2030-05-01T21:00");
    f.layouts_loaded(venue_layouts());
    f
}

fn choose(f: &mut Form, id: &str) {
    f.choose_layout(Some(id));
    assert_eq!(f.seating_status(), Some("Loading the layout…"));
    f.layout_loaded(detail(if id == "l-arena" {
        fixtures::arena()
    } else {
        fixtures::club()
    }));
}

/// Opens a section and answers its reads.
fn open(f: &mut Form, id: &str) {
    for request in f.open_section(id) {
        match request {
            SectionRequest::Layout {
                layout_id,
                section_id,
            } => {
                assert_eq!(layout_id, f.seating.layout_id.clone().unwrap());
                f.section_loaded(seats(&section_id));
            }
            SectionRequest::VenueMap { .. } => {}
        }
    }
}

fn price_box(f: &Form, level: &str) -> Option<String> {
    f.level_rows()
        .into_iter()
        .find(|r| r.name == level)
        .and_then(|r| r.price_box.then_some(r.price))
}

#[test]
fn the_venues_layouts_and_general_admission_are_offered() {
    let mut f = arena_form();
    assert_eq!(
        f.layout_options(),
        vec![
            (String::new(), "General admission".to_string()),
            ("l-arena".to_string(), "Arena (70 seats)".to_string()),
            ("l-club".to_string(), "Club (12 seats)".to_string()),
        ]
    );
    assert!(!f.seated());
    assert_eq!(f.seating.layout_id, None);
    choose(&mut f, "l-arena");
    assert!(f.seated());
    assert_eq!(
        f.seated_total_note().as_deref(),
        Some("Total tickets: 70, the seats on sale.")
    );
}

#[test]
fn each_level_shows_its_color_seats_on_sale_and_a_price_from_the_latest_prices() {
    let mut f = arena_form();
    choose(&mut f, "l-arena");
    let rows = f.level_rows();
    assert_eq!(
        rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
        ["Front", "Back", "Upper"]
    );
    assert_eq!(rows[0].swatch_class, "level-swatch level-swatch--violet");
    assert_eq!(rows[0].on_sale_text, "30");
    assert_eq!(rows[0].price_id, "price-l-front");
    assert_eq!(rows[0].price_label, "Front price");
    assert_eq!(price_box(&f, "Front").as_deref(), Some("90.00"));
    assert_eq!(price_box(&f, "Back").as_deref(), Some("55.00"));
    assert_eq!(price_box(&f, "Upper").as_deref(), Some(""));
    assert_eq!(
        f.prices_from_note().as_deref(),
        Some("Prices from Earlier game, the event most recently scheduled on Arena.")
    );
    assert_eq!(
        f.seat_line().as_deref(),
        Some("70 seats on sale · 0 off sale")
    );
    choose(&mut f, "l-club");
    assert_eq!(price_box(&f, "Club seats").as_deref(), Some(""));
    assert_eq!(f.prices_from_note(), None);
    assert_eq!(event::PRICES_CAPTION, "Prices by level");
    assert_eq!(event::PRICE_PLACEHOLDER, "60.00");
    assert_eq!(event::ALL_OFF_SALE, "All seats off sale");
}

#[test]
fn a_layout_answer_for_another_layout_is_dropped() {
    let mut f = arena_form();
    f.choose_layout(Some("l-arena"));
    f.choose_layout(Some("l-club"));
    f.layout_loaded(detail(fixtures::arena()));
    assert_eq!(f.seating_status(), Some("Loading the layout…"));
    assert_eq!(f.level_rows(), vec![]);
    assert_eq!(f.seat_line(), None);
    f.layout_loaded(detail(fixtures::club()));
    assert_eq!(f.seating_status(), None);
}

#[test]
fn a_section_a_row_and_a_seat_go_off_sale_updating_the_line_at_once() {
    let mut f = arena_form();
    choose(&mut f, "l-arena");
    assert_eq!(
        f.section_choices(),
        vec![
            ("s-a".to_string(), "Section Floor A".to_string()),
            ("s-b".to_string(), "Section Floor B".to_string()),
            ("s-bal".to_string(), "Section Balcony".to_string()),
        ]
    );
    open(&mut f, "s-bal");
    assert_eq!(f.open_section_heading().as_deref(), Some("Section Balcony"));
    f.toggle_whole_section();
    assert_eq!(
        f.seat_line().as_deref(),
        Some("60 seats on sale · 10 off sale")
    );
    assert_eq!(price_box(&f, "Upper"), None);
    let upper = f
        .level_rows()
        .into_iter()
        .find(|r| r.name == "Upper")
        .unwrap();
    assert_eq!(upper.on_sale_text, "0");
    assert!(!upper.price_box);
    assert_eq!(
        f.section_tool().unwrap().whole_label(),
        "Whole section on sale"
    );

    f.close_section();
    assert_eq!(f.open_section_heading(), None);
    open(&mut f, "s-a");
    f.toggle_row(1);
    assert_eq!(
        f.seat_line().as_deref(),
        Some("50 seats on sale · 20 off sale")
    );
    f.toggle_seat(2, 3);
    assert!(f.section_tool().unwrap().seat(2, 3).unwrap().pressed);
    assert_eq!(
        f.seat_line().as_deref(),
        Some("49 seats on sale · 21 off sale")
    );
    f.toggle_row(1);
    assert_eq!(
        f.seat_line().as_deref(),
        Some("59 seats on sale · 11 off sale")
    );
}

#[test]
fn a_seated_schedule_is_one_request_with_layout_level_prices_and_off_sale() {
    let mut f = arena_form();
    choose(&mut f, "l-arena");
    open(&mut f, "s-bal");
    f.toggle_whole_section();
    f.close_section();
    open(&mut f, "s-a");
    f.toggle_seat(2, 3);
    f.set_level_price("l-front", "95.00");
    let body = create_body(&mut f);
    assert_eq!(body["layoutId"], "l-arena");
    assert_eq!(
        body["levelPrices"],
        json!([{ "levelId": "l-front", "price": "95.00" }, { "levelId": "l-back", "price": "55.00" }])
    );
    assert_eq!(
        body["offSale"],
        json!([{ "sectionId": "s-bal" }, { "sectionId": "s-a", "row": 2, "seat": 3 }])
    );
    assert_eq!(body["basePrice"], "55.00");
    for field in ["reservedSeating", "tiers", "totalTicketCapacity"] {
        assert!(!has_key(&body, field), "{field}");
    }
}

#[test]
fn an_empty_on_sale_price_is_shown_beside_its_box_focused_and_nothing_is_sent() {
    let mut f = arena_form();
    choose(&mut f, "l-club");
    assert_eq!(invalid_focus(&mut f), "price-l-club");
    assert_eq!(
        f.field_hint("levelPrices.l-club"),
        vec!["Give Club seats a price."]
    );
    assert!(f.field_invalid("levelPrices.l-club"));
}

#[test]
fn the_backends_400_level_prices_goes_beside_the_levels_box_every_value_kept() {
    let mut f = arena_form();
    choose(&mut f, "l-arena");
    f.set_level_price("l-upper", "35.00");
    create_body(&mut f);
    let focus = f.create_failed(refused(
        400,
        "VALIDATION_FAILED",
        "Give Back a price: it has seats on sale.",
        Some(json!({
            "field": "levelPrices",
            "fields": ["levelPrices needs a price for Back, which has seats on sale"],
            "levels": [{ "levelId": "l-back", "name": "Back" }],
        })),
    ));
    assert_eq!(focus.as_deref(), Some("price-l-back"));
    assert_eq!(
        f.field_hint("levelPrices.l-back"),
        vec!["Give Back a price: it has seats on sale."]
    );
    assert!(!f.times_refusal());
    assert_eq!(f.submit_error(), None);
    assert_eq!(price_box(&f, "Upper").as_deref(), Some("35.00"));
    assert_eq!(f.seating.layout_id.as_deref(), Some("l-arena"));
}

#[test]
fn a_409_seat_taken_goes_beside_the_seats_off_sale() {
    let mut f = arena_form();
    choose(&mut f, "l-arena");
    open(&mut f, "s-a");
    f.toggle_row(1);
    f.set_level_price("l-upper", "35.00");
    create_body(&mut f);
    let focus = f.create_failed(refused(
        409,
        "SEAT_TAKEN",
        "Section Floor A, Row 1, Seat 4 is sold or held, so it can't be taken off sale.",
        Some(
            json!({ "field": "offSale", "seats": [{ "section": "Floor A", "row": 1, "seat": 4 }] }),
        ),
    ));
    assert_eq!(focus.as_deref(), Some("offSale"));
    assert!(f.field_hint("offSale")[0].contains("Row 1, Seat 4 is sold or held"));
    assert_eq!(
        f.seat_line().as_deref(),
        Some("60 seats on sale · 10 off sale")
    );
}

fn arena_seating() -> EventSeating {
    serde_json::from_value(json!({
        "eventId": EVENT_ID,
        "layoutId": "l-arena",
        "levels": [
            { "levelId": "l-front", "name": "Front", "rank": 1, "color": "violet", "seatCount": 30, "seatsOnSale": 30, "price": "95.00" },
            { "levelId": "l-back", "name": "Back", "rank": 2, "color": "teal", "seatCount": 30, "seatsOnSale": 30, "price": "60.00" },
            { "levelId": "l-upper", "name": "Upper", "rank": 3, "color": "blue", "seatCount": 10, "seatsOnSale": 0, "price": null },
        ],
        "offSale": [{ "sectionId": "s-bal" }],
        "seatsOnSale": 60,
        "seatsOffSale": 10,
    }))
    .unwrap()
}

fn seated_edit(tickets_left: i64) -> Form {
    let event = fixtures::with(
        fixtures::event(),
        json!({ "reservedSeating": true, "layoutId": "l-arena", "priceMax": "95.00", "totalTicketCapacity": 60 }),
    );
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(seated_venue(70))]);
    f.event_loaded(&serde_json::from_value(event).unwrap(), vec![]);
    f.tiers_loaded(
        &[],
        Some(&arena_seating()),
        Some(&availability(tickets_left, json!([]))),
    );
    f.layouts_loaded(venue_layouts());
    f.layout_loaded(detail(fixtures::arena()));
    f
}

#[test]
fn an_edit_loads_its_seating_layout_prices_and_seats_off_sale() {
    let f = seated_edit(60);
    assert_eq!(price_box(&f, "Front").as_deref(), Some("95.00"));
    assert_eq!(f.seating.layout_id.as_deref(), Some("l-arena"));
    assert_eq!(f.layout_lock_reason(), None);
    assert_eq!(price_box(&f, "Back").as_deref(), Some("60.00"));
    assert_eq!(price_box(&f, "Upper"), None);
    assert_eq!(
        f.seat_line().as_deref(),
        Some("60 seats on sale · 10 off sale")
    );
    assert_eq!(
        f.seated_total_note().as_deref(),
        Some("Total tickets: 60, the seats on sale.")
    );
}

#[test]
fn an_edit_with_seats_sold_locks_the_layout_and_disables_sold_and_held_seats() {
    let mut f = seated_edit(58);
    assert_eq!(f.sold.event_sold, 2);
    assert_eq!(
        f.layout_lock_reason(),
        Some("Can't be changed: seats have been sold.")
    );
    let requests = f.open_section("s-a");
    assert_eq!(
        requests,
        vec![
            SectionRequest::Layout {
                layout_id: "l-arena".into(),
                section_id: "s-a".into()
            },
            SectionRequest::VenueMap {
                event_id: EVENT_ID.into(),
                section_id: "s-a".into()
            },
        ]
    );
    // Each section is asked for once.
    assert!(f.open_section("s-a").is_empty());
    f.section_loaded(seats("s-a"));
    let mut taken = admin_rust_core::forms::off_sale::TakenSeats::new();
    taken.insert("1/4".into(), Taken::Sold);
    taken.insert("1/5".into(), Taken::Reserved);
    f.taken_loaded("s-a", taken);
    let tool = f.section_tool().unwrap();
    assert_eq!(tool.seat(1, 4).unwrap().label, "Row 1, Seat 4, sold");
    assert_eq!(tool.seat(1, 5).unwrap().label, "Row 1, Seat 5, held");
    assert_eq!(
        tool.taken_note(),
        Some("Sold and held seats can't be taken off sale.")
    );
    assert!(tool.rows()[0].disabled);
    assert!(tool.whole_disabled());
    assert_eq!(tool.seat(2, 4).unwrap().taken, None);
    // A taken seat pressed changes nothing.
    let before = f.seating.off_sale.clone();
    f.toggle_seat(1, 4);
    assert_eq!(f.seating.off_sale, before);
}

#[test]
fn an_edit_sends_the_seating_in_one_patch_and_places_event_has_orders_beside_the_layout() {
    let mut f = seated_edit(60);
    f.choose_layout(Some("l-club"));
    f.layout_loaded(detail(fixtures::club()));
    f.set_level_price("l-club", "20.00");
    let body = update_body(&mut f);
    assert_eq!(body["layoutId"], "l-club");
    assert_eq!(
        body["levelPrices"],
        json!([{ "levelId": "l-club", "price": "20.00" }])
    );
    assert_eq!(body["offSale"], json!([]));
    assert!(!has_key(&body, "tiers"));
    let focus = f.save_failed(refused(
        409,
        "EVENT_HAS_ORDERS",
        "Season Opener has sold or held seats, so its layout can no longer change.",
        Some(json!({ "field": "layoutId", "ticketsSold": 0, "seatsHeld": 1 })),
    ));
    assert_eq!(focus.as_deref(), Some("layoutId"));
    assert!(f.field_hint("layoutId")[0].starts_with("Season Opener has sold or held seats"));
    assert_eq!(f.seating.layout_id.as_deref(), Some("l-club"));
    assert_eq!(price_box(&f, "Club seats").as_deref(), Some("20.00"));
}

#[test]
fn a_seated_event_put_back_on_general_admission_sends_layout_null() {
    let mut f = seated_edit(60);
    f.choose_layout(None);
    assert!(!f.seated());
    type_line(&mut f, 0, "Floor", "10.00", Some("10"));
    let body = update_body(&mut f);
    assert_eq!(body["layoutId"], Value::Null);
    assert_eq!(
        body["tiers"],
        json!([{ "name": "Floor", "price": "10.00", "quantity": 10 }])
    );
    // A seated event never sends a total, but general admission does once typed.
    assert_eq!(body["totalTicketCapacity"], 60);
}

#[test]
fn an_edit_whose_seating_could_not_be_read_saves_details_only() {
    let event = fixtures::with(
        fixtures::event(),
        json!({ "reservedSeating": true, "layoutId": "l-arena", "totalTicketCapacity": 60 }),
    );
    let mut f = Form::edit(EVENT_ID);
    f.venues_loaded(vec![venue(seated_venue(70))]);
    f.event_loaded(&serde_json::from_value(event).unwrap(), vec![]);
    f.tiers_loaded(&[], None, None);
    assert!(f.details_only());
    assert!(f.details_only_note().is_some());
    // Quirk kept: the form then shows general admission's empty ticket type, whose checks block
    // the save until it is filled, though it is not sent.
    assert_eq!(invalid_focus(&mut f), "type-1-name");
    type_line(&mut f, 0, "Floor", "10.00", Some("10"));
    let body = update_body(&mut f);
    for field in [
        "layoutId",
        "levelPrices",
        "offSale",
        "tiers",
        "totalTicketCapacity",
    ] {
        assert!(!has_key(&body, field), "{field}");
    }
    assert_eq!(body["basePrice"], "45.00");
}

#[test]
fn sections_a_count_needs_load_by_themselves_and_a_failed_read_is_asked_again() {
    let mut f = arena_form();
    choose(&mut f, "l-arena");
    f.set_off_sale(vec![
        admin_rust_core::forms::off_sale::OffSaleSelector::row("s-b", 1),
    ]);
    let needed = f.sections_needed();
    assert_eq!(
        needed,
        vec![SectionRequest::Layout {
            layout_id: "l-arena".into(),
            section_id: "s-b".into()
        }]
    );
    assert!(f.sections_needed().is_empty());
    f.section_failed("l-arena", "s-b");
    assert_eq!(f.sections_needed().len(), 1);
    f.section_loaded(seats("s-b"));
    assert_eq!(
        f.seat_line().as_deref(),
        Some("60 seats on sale · 10 off sale")
    );
    assert!(f.sections_needed().is_empty());
    // Changing the layout starts over.
    f.choose_layout(Some("l-club"));
    assert!(f.seating.off_sale.is_empty());
    assert!(f.section_seats.is_empty());
}

// ---------------------------------------------------------------- event-seating-create.test.tsx

#[test]
fn a_venue_with_layouts_starts_on_general_admission_with_types_and_a_total() {
    let mut f = new_form(vec![
        seated_venue(70),
        fixtures::venue("v-plain", "Plain Hall", 22090),
    ]);
    f.set_name("Season Opener");
    f.choose_venue(VENUE_ID, now());
    f.layouts_loaded(venue_layouts());
    assert!(f.show_seating_select());
    assert!(!f.seated());
    assert_eq!(f.seated_total_note(), None);
    choose(&mut f, "l-club");
    assert_eq!(
        f.seated_total_note().as_deref(),
        Some("Total tickets: 12, the seats on sale.")
    );
}

#[test]
fn a_refused_schedule_keeps_every_value() {
    let message = "Club room is already committed at that time.";
    let mut f = fill_seated();
    create_body(&mut f);
    f.create_failed(refused(409, "EVENT_CANCELLED", message, None));
    assert_eq!(f.submit_error().as_deref(), Some(message));
    assert_eq!(f.name, "Season Opener");
    assert_eq!(f.seating.layout_id.as_deref(), Some("l-club"));
    assert_eq!(price_box(&f, "Club seats").as_deref(), Some("20.00"));
    assert!(!f.saved);
}

#[test]
fn a_venue_without_layouts_has_no_seating_choice() {
    let f = plain_form("Season Opener");
    assert!(f.show_tickets_and_seating());
    assert!(!f.show_seating_select());
}

#[test]
fn another_venue_starts_on_general_admission_and_asks_repeated_times_again() {
    let mut f = arena_form();
    choose(&mut f, "l-club");
    set_local(&mut f, TimeField::StartsAt, "2027-11-07T01:30");
    f.choose_occurrence(TimeField::StartsAt, Occurrence::First);
    f.choose_venue("v-other", now());
    assert!(!f.seated());
    assert_eq!(f.occurrence.get(TimeField::StartsAt), Occurrence::Unset);
    assert!(!f.show_tickets_and_seating());
}

// ---------------------------------------------------------------- when checks show (035)

#[test]
fn checks_show_once_a_field_is_left_then_live_and_are_announced() {
    let mut f = plain_form("");
    assert!(f.field_hint("name").is_empty());
    f.blur("name");
    assert_eq!(f.field_hint("name"), vec![MSG_NAME]);
    f.refresh_live();
    assert_eq!(f.live, MSG_NAME);
    // Already announced: not again.
    f.blur("startsAt");
    f.refresh_live();
    assert_eq!(f.live, MSG_NAME);
    f.set_name("Fixed");
    assert!(f.field_hint("name").is_empty());
    f.blur("tiers.0.name");
    f.refresh_live();
    assert_eq!(f.live, "Give this ticket type a name.");
    f.set_type(0, TypeField::Name, "Floor");
    f.set_type(0, TypeField::Price, "1.00");
    f.set_type(0, TypeField::Quantity, "1");
    f.refresh_live();
    assert_eq!(f.live, "");
}

#[test]
fn type_hints_show_server_messages_first_else_the_previews() {
    let mut f = plain_form("X");
    f.blur("tiers.0.price");
    f.blur("tiers.0.quantity");
    assert_eq!(
        f.type_hint(0),
        vec![
            "Give this ticket type a price.",
            "Give this ticket type a quantity."
        ]
    );
    assert!(f.type_invalid(0, TypeField::Price));
    assert!(!f.type_invalid(0, TypeField::Name));
}

#[test]
fn removing_and_adding_types_and_the_over_capacity_hint() {
    let mut f = plain_form("Fair");
    f.set_total("10");
    type_line(&mut f, 0, "Floor", "1.00", Some("8"));
    f.add_type();
    type_line(&mut f, 1, "Lawn", "1.00", Some("8"));
    assert_eq!(
        f.seat_total_line(),
        "16 of 10 seats assigned 6 seats over the event's capacity"
    );
    f.blur("tiers");
    assert_eq!(
        f.seating_hint(),
        vec!["Fair has 10 tickets, but its ticket types add up to 16."]
    );
    assert_eq!(invalid_focus(&mut f), "tickets-and-seating");
    f.remove_type(1);
    assert_eq!(f.types.len(), 1);
    assert!(f.seating_hint().is_empty());
}

#[test]
fn a_failed_edit_load_puts_its_message_by_the_buttons() {
    let mut f = Form::edit(EVENT_ID);
    f.event_failed(refused(404, "NOT_FOUND", "No such event.", None));
    assert_eq!(f.submit_error().as_deref(), Some("No such event."));
}

#[test]
fn reading_the_api_resolves_local_times_as_the_shared_helper() {
    // The form reads times through `resolve_local`; a malformed one is "not given".
    assert!(event::resolve_field("", "America/New_York").is_none());
    assert!(event::resolve_field("x", "America/New_York").is_none());
    let r = resolve_local("2027-11-07T01:30", "America/New_York").unwrap();
    assert!(matches!(r, ResolvedLocal::Repeated { .. }));
    assert!(event::moment_of(&r, Occurrence::Unset).is_none());
    assert_eq!(
        event::moment_of(&r, Occurrence::First).unwrap().offset,
        "-04:00"
    );
    assert_eq!(Occurrence::Second.as_str(), "second");
    assert_eq!(TimeField::DoorsOpenAt.key(), "doorsOpenAt");
}

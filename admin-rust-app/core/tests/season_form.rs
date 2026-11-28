//! Spec 041 T021 (FR-002 to FR-006, FR-009, FR-010, FR-017, FR-018; research R4, R11, R12): the
//! Season form's checks as previews of the Backend's rules (which stay authoritative), keyed by
//! the Backend's own field paths, so a preview and a refusal land in the same place. Each case is
//! one of `admin-app/test/season-form-checks.test.ts`, in the same order; the request the form
//! sends is also checked against `contracts/openapi.yaml`'s `SeasonInput`.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use admin_rust_core::api::client::{ApiError, error_from};
use admin_rust_core::api::types::SeasonStatus;
use admin_rust_core::forms::season::{
    GENERAL_ADMISSION, PreviewEvent, PreviewLevel, SPORTS, SeasonDraft, SeasonPreviewContext,
    by_name, field_order, first_error_key, focus_id_for, level_price_message, place_season_errors,
    preview_season, price_keys, same_draft, season_msg, tier_key, to_season_input,
};
use admin_rust_core::pages::seasons::{
    PickOptions, PickerEvent, SeasonClock, SeasonRef, pickable_events, season_status_text,
    sport_team_text,
};
use admin_rust_core::time::parse_instant;
use serde_json::{Value, json};

const ZONE: &str = "America/New_York";
const VENUE: &str = "11111111-1111-4111-8111-111111111111";
const LAYOUT: &str = "33333333-3333-4333-8333-333333333333";
const LOWER: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPPER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

fn prices(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn draft() -> SeasonDraft {
    SeasonDraft {
        name: "Spring Hoops".into(),
        location_id: VENUE.into(),
        layout: LAYOUT.into(),
        sport: "BASKETBALL".into(),
        team: "Test Team".into(),
        sales_end_at: "2026-12-10T18:00".into(),
        single_sales_open_at: String::new(),
        max_passes_per_customer: String::new(),
        event_ids: vec!["e1".into(), "e2".into()],
        prices: prices(&[(LOWER, "100.00"), (UPPER, "60.00")]),
    }
}

fn event(id: &str, name: &str, starts_at: &str) -> PreviewEvent {
    PreviewEvent {
        id: id.into(),
        name: name.into(),
        starts_at: starts_at.into(),
        status: "SCHEDULED".into(),
    }
}

fn ctx() -> SeasonPreviewContext {
    SeasonPreviewContext {
        zone: ZONE.into(),
        events: vec![
            event("e1", "Game 1", "2026-12-11T00:00:00Z"),
            event("e2", "Game 2", "2026-12-18T00:00:00Z"),
        ],
        levels: vec![
            PreviewLevel {
                id: LOWER.into(),
                name: "Lower".into(),
                rank: 1,
            },
            PreviewLevel {
                id: UPPER.into(),
                name: "Upper".into(),
                rank: 2,
            },
        ],
        tier_names: vec![],
        complete: false,
        publishing: false,
    }
}

fn complete() -> SeasonPreviewContext {
    SeasonPreviewContext {
        complete: true,
        ..ctx()
    }
}

// ---------------------------------------------------------------- previewSeason

#[test]
fn finds_nothing_wrong_with_a_complete_seated_season() {
    assert!(preview_season(&draft(), &complete()).is_empty());
}

#[test]
fn marks_each_required_field_name_venue_layout_pass_sales_end() {
    let errors = preview_season(
        &SeasonDraft {
            name: "  ".into(),
            location_id: String::new(),
            layout: String::new(),
            sales_end_at: String::new(),
            ..draft()
        },
        &ctx(),
    );
    assert_eq!(errors.get("name"), Some(season_msg::NAME));
    assert_eq!(errors.get("locationId"), Some(season_msg::VENUE));
    assert_eq!(errors.get("layoutId"), Some(season_msg::LAYOUT));
    assert_eq!(errors.get("salesEndAt"), Some(season_msg::SALES_END));
}

#[test]
fn refuses_a_name_over_100_characters() {
    let named = |n: usize| SeasonDraft {
        name: "x".repeat(n),
        ..draft()
    };
    assert_eq!(
        preview_season(&named(101), &ctx()).get("name"),
        Some(season_msg::NAME_LENGTH)
    );
    assert!(!preview_season(&named(100), &ctx()).has("name"));
}

#[test]
fn asks_for_sport_and_team_together_both_or_neither() {
    let no_team = SeasonDraft {
        team: String::new(),
        ..draft()
    };
    assert_eq!(
        preview_season(&no_team, &ctx()).get("team"),
        Some(season_msg::TEAM)
    );
    let no_sport = SeasonDraft {
        sport: String::new(),
        ..draft()
    };
    assert_eq!(
        preview_season(&no_sport, &ctx()).get("sport"),
        Some(season_msg::SPORT)
    );
    let neither = SeasonDraft {
        sport: String::new(),
        team: String::new(),
        ..draft()
    };
    assert!(preview_season(&neither, &ctx()).is_empty());
    let long = SeasonDraft {
        team: "t".repeat(101),
        ..draft()
    };
    assert_eq!(
        preview_season(&long, &ctx()).get("team"),
        Some(season_msg::TEAM_LENGTH)
    );
}

#[test]
fn takes_passes_per_customer_from_1_to_10_or_blank() {
    for bad in ["0", "11", "2.5", "x"] {
        let d = SeasonDraft {
            max_passes_per_customer: bad.into(),
            ..draft()
        };
        assert_eq!(
            preview_season(&d, &ctx()).get("maxPassesPerCustomer"),
            Some(season_msg::PASSES),
            "{bad}"
        );
    }
    for good in ["", "1", "10"] {
        let d = SeasonDraft {
            max_passes_per_customer: good.into(),
            ..draft()
        };
        assert!(preview_season(&d, &ctx()).is_empty(), "{good}");
    }
}

#[test]
fn refuses_a_sales_end_after_the_first_event_starts_naming_it_and_single_sales_after_it() {
    let at = |sales_end: &str, presale: &str| SeasonDraft {
        sales_end_at: sales_end.into(),
        single_sales_open_at: presale.into(),
        ..draft()
    };
    // Game 1 starts at 7:00 PM Eastern on Dec 10.
    assert!(preview_season(&at("2026-12-10T19:00", ""), &ctx()).is_empty());
    let late = preview_season(&at("2026-12-10T19:01", ""), &ctx());
    assert_eq!(
        late.get("salesEndAt"),
        Some(
            "Pass sales must end by the start of the first event, Game 1 (Dec 10, 2026, 7:00 PM EST)."
        )
    );
    let presale = preview_season(&at("2026-12-10T18:00", "2026-12-10T18:01"), &ctx());
    assert_eq!(presale.get("singleSalesOpenAt"), Some(season_msg::PRESALE));
    assert!(preview_season(&at("2026-12-10T18:00", "2026-12-10T18:00"), &ctx()).is_empty());
}

#[test]
fn ignores_a_cancelled_event_when_finding_the_first_start() {
    let mut c = ctx();
    c.events[0].status = "CANCELLED".into();
    let d = SeasonDraft {
        sales_end_at: "2026-12-15T12:00".into(),
        ..draft()
    };
    assert!(preview_season(&d, &c).is_empty());
}

#[test]
fn says_a_skipped_local_time_is_skipped() {
    let c = SeasonPreviewContext {
        events: vec![],
        ..ctx()
    };
    let d = SeasonDraft {
        sales_end_at: "2026-03-08T02:30".into(),
        ..draft()
    };
    let errors = preview_season(&d, &c);
    assert!(errors.get("salesEndAt").unwrap().contains("2:30 AM"));
    // A presale time the clocks skip says so too; one that is not a time at all has its own
    // message (review).
    let d = SeasonDraft {
        single_sales_open_at: "2026-03-08T02:30".into(),
        ..draft()
    };
    assert!(
        preview_season(&d, &c)
            .get("singleSalesOpenAt")
            .unwrap()
            .contains("doesn't exist in Eastern Time")
    );
    let d = SeasonDraft {
        single_sales_open_at: "2026-13-45T99:99".into(),
        ..draft()
    };
    assert_eq!(
        preview_season(&d, &c).get("singleSalesOpenAt"),
        Some(season_msg::PRESALE_TIME)
    );
    assert_eq!(
        season_msg::PRESALE_TIME,
        "Enter when single tickets go on sale, or leave both its date and time blank."
    );
    // An unreadable sales end is the sales end's message.
    let d = SeasonDraft {
        sales_end_at: "2026-13-45T99:99".into(),
        ..draft()
    };
    assert_eq!(
        preview_season(&d, &c).get("salesEndAt"),
        Some(season_msg::SALES_END)
    );
}

#[test]
fn takes_the_first_of_a_repeated_local_time() {
    // 1:30 AM on Nov 1, 2026 happens twice in Eastern Time; the first is EDT (05:30Z).
    let c = SeasonPreviewContext {
        events: vec![event("e1", "Game 1", "2026-11-01T05:45:00Z")],
        ..ctx()
    };
    let d = SeasonDraft {
        sales_end_at: "2026-11-01T01:30".into(),
        event_ids: vec!["e1".into()],
        ..draft()
    };
    assert!(preview_season(&d, &c).is_empty());
    let (input, _) = to_season_input(&d, &c);
    assert_eq!(input["salesEndAt"], "2026-11-01T01:30:00-04:00");
}

#[test]
fn refuses_a_price_over_99_999_999_99() {
    // Review 041 (contract SeasonPriceInput.price `^\d{1,8}(\.\d{1,2})?$`).
    let d = SeasonDraft {
        prices: prices(&[(LOWER, "100000000"), (UPPER, "99999999.99")]),
        ..draft()
    };
    let errors = preview_season(&d, &ctx());
    assert_eq!(
        errors.get(&format!("prices.{LOWER}")),
        Some(season_msg::PRICE)
    );
    assert!(!errors.has(&format!("prices.{UPPER}")));
    assert_eq!(
        season_msg::PRICE,
        "Enter a price such as 640.00, at most 99999999.99."
    );
}

#[test]
fn refuses_a_malformed_price_keyed_by_its_level() {
    let d = SeasonDraft {
        prices: prices(&[(LOWER, "1.234"), (UPPER, "-1")]),
        ..draft()
    };
    let errors = preview_season(&d, &ctx());
    assert_eq!(
        errors.get(&format!("prices.{LOWER}")),
        Some(season_msg::PRICE)
    );
    assert_eq!(
        errors.get(&format!("prices.{UPPER}")),
        Some(season_msg::PRICE)
    );
}

#[test]
fn lets_a_draft_save_with_a_level_unpriced_but_not_one_on_sale_or_being_put_on_sale() {
    let one = SeasonDraft {
        prices: prices(&[(LOWER, "100.00")]),
        ..draft()
    };
    assert!(preview_season(&one, &ctx()).is_empty());
    assert_eq!(
        preview_season(&one, &complete())
            .get(&format!("prices.{UPPER}"))
            .map(str::to_string),
        Some("Give Upper a price.".to_string())
    );
    assert_eq!(level_price_message("Upper"), "Give Upper a price.");
}

#[test]
fn asks_for_at_least_2_events_not_cancelled_to_put_a_season_on_sale_not_to_save_one() {
    let one = SeasonDraft {
        event_ids: vec!["e1".into()],
        ..draft()
    };
    assert!(preview_season(&one, &complete()).is_empty());
    let publishing = SeasonPreviewContext {
        publishing: true,
        ..complete()
    };
    assert_eq!(
        preview_season(&one, &publishing).get("eventIds"),
        Some(season_msg::TWO_EVENTS)
    );
}

#[test]
fn asks_a_general_admission_season_for_at_least_one_priced_name_to_stay_sellable() {
    let ga = SeasonDraft {
        layout: GENERAL_ADMISSION.into(),
        prices: BTreeMap::new(),
        ..draft()
    };
    let ga_ctx = SeasonPreviewContext {
        levels: vec![],
        tier_names: vec!["General".into()],
        complete: true,
        ..ctx()
    };
    assert_eq!(
        preview_season(&ga, &ga_ctx).get("prices"),
        Some(season_msg::ONE_NAME)
    );
    let priced = SeasonDraft {
        layout: GENERAL_ADMISSION.into(),
        prices: prices(&[("tier:general", "50")]),
        ..draft()
    };
    assert!(preview_season(&priced, &ga_ctx).is_empty());
}

#[test]
fn price_keys_are_the_levels_by_rank_or_the_offered_names() {
    let mut c = ctx();
    c.levels.reverse();
    assert_eq!(price_keys(&draft(), &c), [LOWER, UPPER]);
    let ga = SeasonDraft {
        layout: GENERAL_ADMISSION.into(),
        ..draft()
    };
    let ga_ctx = SeasonPreviewContext {
        tier_names: vec![" VIP ".into(), "General".into()],
        ..ctx()
    };
    assert_eq!(price_keys(&ga, &ga_ctx), ["tier:vip", "tier:general"]);
    assert_eq!(tier_key("  Lawn Seats "), "tier:lawn seats");
}

#[test]
fn the_sports_are_the_contracts_in_its_order_with_their_words() {
    let values: Vec<&str> = SPORTS.iter().map(|(v, _)| *v).collect();
    assert_eq!(
        values,
        [
            "BASKETBALL",
            "FOOTBALL",
            "BASEBALL",
            "SOCCER",
            "HOCKEY",
            "VOLLEYBALL"
        ]
    );
    assert_eq!(SPORTS[0].1, "Basketball");
    assert_eq!(SPORTS[5].1, "Volleyball");
}

// ---------------------------------------------------------------- fieldOrder and firstErrorKey

#[test]
fn runs_top_to_bottom_the_price_boxes_in_order_so_focus_goes_to_the_first_at_fault() {
    let keys = [LOWER.to_string(), UPPER.to_string()];
    assert_eq!(
        field_order(&keys),
        [
            "name".to_string(),
            "locationId".into(),
            "layoutId".into(),
            "sport".into(),
            "team".into(),
            "salesEndAt".into(),
            "singleSalesOpenAt".into(),
            "maxPassesPerCustomer".into(),
            "eventIds".into(),
            format!("prices.{LOWER}"),
            format!("prices.{UPPER}"),
            "prices".into(),
        ]
    );
    let present = [format!("prices.{UPPER}"), "salesEndAt".to_string()];
    assert_eq!(
        first_error_key(&present, &keys).as_deref(),
        Some("salesEndAt")
    );
    assert_eq!(
        first_error_key(&["other".to_string()], &[]).as_deref(),
        Some("other")
    );
    assert_eq!(first_error_key(&[], &[]), None);
}

#[test]
fn focus_goes_to_the_date_half_of_a_time_and_to_a_price_box_by_its_key() {
    assert_eq!(focus_id_for("salesEndAt"), "salesEndAt-date");
    assert_eq!(focus_id_for("singleSalesOpenAt"), "singleSalesOpenAt-date");
    assert_eq!(
        focus_id_for(&format!("prices.{LOWER}")),
        format!("price-{LOWER}")
    );
    assert_eq!(focus_id_for("prices.tier:vip"), "price-tier:vip");
    assert_eq!(focus_id_for("prices"), "prices");
    assert_eq!(focus_id_for("eventIds"), "eventIds");
}

// ---------------------------------------------------------------- toSeasonInput

static COMPONENTS: LazyLock<Value> = LazyLock::new(|| {
    let text = include_str!("../../../contracts/openapi.yaml");
    let doc: Value = serde_yaml::from_str(text).expect("parse the contract");
    doc["components"].clone()
});

/// Checks `body` against `components.schemas.SeasonInput`, formats included.
fn conforms(body: &Value) {
    let schema = json!({
        "$ref": "#/components/schemas/SeasonInput",
        "components": *COMPONENTS,
    });
    let validator = jsonschema::options()
        .should_validate_formats(true)
        .build(&schema)
        .expect("a valid schema");
    let errors: Vec<String> = validator.iter_errors(body).map(|e| e.to_string()).collect();
    assert!(errors.is_empty(), "SeasonInput: {errors:?} in {body}");
}

#[test]
fn sends_the_times_in_the_venue_offset_the_levels_priced_in_rank_order_blanks_as_null() {
    let d = SeasonDraft {
        prices: prices(&[(UPPER, " 60 "), (LOWER, "")]),
        max_passes_per_customer: "4".into(),
        single_sales_open_at: "2026-12-01T10:00".into(),
        ..draft()
    };
    let (input, keys) = to_season_input(&d, &ctx());
    assert_eq!(
        input,
        json!({
            "name": "Spring Hoops",
            "sport": "BASKETBALL",
            "team": "Test Team",
            "locationId": VENUE,
            "layoutId": LAYOUT,
            "salesEndAt": "2026-12-10T18:00:00-05:00",
            "singleSalesOpenAt": "2026-12-01T10:00:00-05:00",
            "maxPassesPerCustomer": 4,
            "eventIds": ["e1", "e2"],
            "prices": [{ "levelId": UPPER, "price": "60" }],
        })
    );
    assert_eq!(keys, [format!("prices.{UPPER}")]);
}

#[test]
fn sends_general_admission_as_a_null_layout_and_names_by_their_offered_spelling() {
    let d = SeasonDraft {
        layout: GENERAL_ADMISSION.into(),
        sport: String::new(),
        team: String::new(),
        prices: prices(&[("tier:general", "50.00"), ("tier:gone", "9.00")]),
        ..draft()
    };
    let c = SeasonPreviewContext {
        levels: vec![],
        tier_names: vec!["General".into(), "VIP".into()],
        ..ctx()
    };
    let (input, keys) = to_season_input(&d, &c);
    assert_eq!(input["layoutId"], Value::Null);
    assert_eq!(input["sport"], Value::Null);
    assert_eq!(input["team"], Value::Null);
    assert_eq!(input["singleSalesOpenAt"], Value::Null);
    assert_eq!(input["maxPassesPerCustomer"], Value::Null);
    assert_eq!(
        input["prices"],
        json!([{ "tierName": "General", "price": "50.00" }])
    );
    assert_eq!(keys, ["prices.tier:general"]);
}

#[test]
fn a_typed_time_that_is_not_one_is_sent_as_typed_and_a_missing_layout_as_null() {
    let d = SeasonDraft {
        layout: String::new(),
        sales_end_at: "soon".into(),
        ..draft()
    };
    let (input, keys) = to_season_input(&d, &ctx());
    assert_eq!(input["salesEndAt"], "soon");
    assert_eq!(input["layoutId"], Value::Null);
    assert_eq!(keys, [format!("prices.{LOWER}"), format!("prices.{UPPER}")]);
}

#[test]
fn every_request_the_form_sends_is_a_season_input_of_the_contract() {
    let ids = [
        "e1000000-0000-4000-8000-000000000001",
        "e1000000-0000-4000-8000-000000000002",
    ];
    let seated = SeasonDraft {
        event_ids: ids.iter().map(|s| s.to_string()).collect(),
        max_passes_per_customer: "10".into(),
        single_sales_open_at: "2026-12-01T10:00".into(),
        ..draft()
    };
    conforms(&to_season_input(&seated, &ctx()).0);
    let ga = SeasonDraft {
        layout: GENERAL_ADMISSION.into(),
        sport: String::new(),
        team: String::new(),
        prices: prices(&[("tier:general", "50.00")]),
        ..seated
    };
    let c = SeasonPreviewContext {
        tier_names: vec!["General".into()],
        ..ctx()
    };
    conforms(&to_season_input(&ga, &c).0);
}

// ---------------------------------------------------------------- placeSeasonErrors

fn refusal(status: u16, error: Value) -> ApiError {
    let body = serde_json::to_vec(&json!({ "error": error })).unwrap();
    let e = error_from(status, &body);
    assert!(e.enveloped, "a contract code: {error}");
    ApiError::Status(e)
}

fn sent() -> (Vec<String>, Vec<String>) {
    (
        vec!["e1".into(), "e2".into()],
        vec![format!("prices.{UPPER}"), "prices.tier:vip".into()],
    )
}

#[test]
fn places_each_400_field_by_its_path_entries_by_index_without_the_path_in_the_message() {
    let (event_ids, keys) = sent();
    let placed = place_season_errors(
        Some(&refusal(
            400,
            json!({
                "code": "VALIDATION_FAILED",
                "message": "Request validation failed.",
                "details": {
                    "fields": [
                        "name must be between 1 and 100 characters",
                        "eventIds.1 Game 2 is at another venue",
                        format!("prices.{LOWER} Give Lower a price."),
                        "prices.1 Show 18 has no ticket type named VIP",
                        "prices must price at least one ticket type name",
                        "something else entirely",
                        7,
                    ]
                }
            }),
        )),
        &event_ids,
        &keys,
        None,
    );
    let get = |k: &str| placed.get(k).map(<[String]>::to_vec);
    assert_eq!(
        get("name"),
        Some(vec![
            "name must be between 1 and 100 characters".to_string()
        ])
    );
    assert_eq!(
        get("eventIds"),
        Some(vec!["Game 2 is at another venue".to_string()])
    );
    assert_eq!(
        get(&format!("prices.{LOWER}")),
        Some(vec!["Give Lower a price.".to_string()])
    );
    assert_eq!(
        get("prices.tier:vip"),
        Some(vec!["Show 18 has no ticket type named VIP".to_string()])
    );
    assert_eq!(
        get("prices"),
        Some(vec![
            "prices must price at least one ticket type name".to_string()
        ])
    );
    assert_eq!(placed.unmapped, ["something else entirely"]);
    assert_eq!(
        placed.keys(),
        [
            "name".to_string(),
            "eventIds".into(),
            format!("prices.{LOWER}"),
            "prices.tier:vip".into(),
            "prices".into(),
        ]
    );
}

#[test]
fn places_a_nested_price_refusal_by_its_entry_and_a_path_no_control_shows_as_general() {
    // Review 041: `prices.<i>.<field>` lands on entry i's box, keeping the field's name.
    let (event_ids, keys) = sent();
    let shown = [format!("prices.{UPPER}"), "prices.tier:vip".to_string()];
    let placed = place_season_errors(
        Some(&refusal(
            400,
            json!({
                "code": "VALIDATION_FAILED",
                "message": "Request validation failed.",
                "details": {
                    "fields": [
                        "prices.0.price must be a non-negative decimal string up to 99999999.99",
                        "prices.7.price must be a decimal string",
                        "prices.cccccccc-cccc-4ccc-8ccc-cccccccccccc Give Gone a price.",
                    ]
                }
            }),
        )),
        &event_ids,
        &keys,
        Some(&shown),
    );
    assert_eq!(
        placed.get(&format!("prices.{UPPER}")),
        Some(&["price must be a non-negative decimal string up to 99999999.99".to_string()][..])
    );
    assert_eq!(placed.fields.len(), 1);
    assert_eq!(
        placed.unmapped,
        [
            "prices.7.price must be a decimal string",
            "prices.cccccccc-cccc-4ccc-8ccc-cccccccccccc Give Gone a price.",
        ]
    );
    // A single field naming a nested entry lands on its box too; a shown box by its key stays.
    let field = place_season_errors(
        Some(&refusal(
            400,
            json!({
                "code": "VALIDATION_FAILED",
                "message": "Too dear.",
                "details": { "field": "prices.1.price" }
            }),
        )),
        &event_ids,
        &keys,
        Some(&shown),
    );
    assert_eq!(
        field.get("prices.tier:vip"),
        Some(&["Too dear.".to_string()][..])
    );
    let by_key = place_season_errors(
        Some(&refusal(
            400,
            json!({
                "code": "VALIDATION_FAILED",
                "message": "x",
                "details": { "fields": ["prices.tier:vip Show 18 has no VIP", "prices Price one."] }
            }),
        )),
        &event_ids,
        &keys,
        Some(&shown),
    );
    assert_eq!(by_key.keys(), ["prices.tier:vip", "prices"]);
}

#[test]
fn places_a_409_naming_its_field_an_event_in_another_season_passes_sold_a_time() {
    let (event_ids, keys) = sent();
    let in_season = place_season_errors(
        Some(&refusal(
            409,
            json!({
                "code": "EVENT_IN_SEASON",
                "message": "Game 2 is already in Winter.",
                "details": { "field": "eventIds.1", "seasonId": "x", "seasonName": "Winter" }
            }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert_eq!(
        in_season.get("eventIds"),
        Some(&["Game 2 is already in Winter.".to_string()][..])
    );
    let passes = place_season_errors(
        Some(&refusal(
            409,
            json!({
                "code": "SEASON_HAS_PASSES",
                "message": "Passes have been sold.",
                "details": { "field": "layoutId", "passesSold": 1 }
            }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert_eq!(
        passes.get("layoutId"),
        Some(&["Passes have been sold.".to_string()][..])
    );
    let offset = place_season_errors(
        Some(&refusal(
            400,
            json!({
                "code": "UTC_OFFSET_MISMATCH",
                "message": "salesEndAt is stated with offset +00:00.",
                "details": { "field": "salesEndAt" }
            }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert_eq!(
        offset.get("salesEndAt"),
        Some(&["salesEndAt is stated with offset +00:00.".to_string()][..])
    );
    // A refusal's `prices.<i>` past the prices sent, or a field the form has no place for, is a
    // general message (review).
    let past = place_season_errors(
        Some(&refusal(
            400,
            json!({
                "code": "VALIDATION_FAILED",
                "message": "No such price.",
                "details": { "field": "prices.9" }
            }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert!(past.is_empty_fields());
    assert_eq!(past.unmapped, ["No such price."]);
    let elsewhere = place_season_errors(
        Some(&refusal(
            409,
            json!({
                "code": "SEASON_NOT_DRAFT",
                "message": "Already on sale.",
                "details": { "field": "status" }
            }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert!(elsewhere.is_empty_fields());
    assert_eq!(elsewhere.unmapped, ["Already on sale."]);
}

#[test]
fn keeps_a_refusal_that_names_no_field_as_a_general_message() {
    let (event_ids, keys) = sent();
    let placed = place_season_errors(
        Some(&refusal(
            409,
            json!({ "code": "SEASON_CANCELLED", "message": "Winter is cancelled." }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert!(placed.is_empty_fields());
    assert_eq!(placed.unmapped, ["Winter is cancelled."]);
    assert!(
        place_season_errors(None, &event_ids, &keys, None,)
            .unmapped
            .is_empty()
    );
    // An empty field list places nothing, as an empty `details.fields` array does in React.
    let empty = place_season_errors(
        Some(&refusal(
            400,
            json!({ "code": "VALIDATION_FAILED", "message": "x", "details": { "fields": [] } }),
        )),
        &event_ids,
        &keys,
        None,
    );
    assert!(empty.is_empty_fields() && empty.unmapped.is_empty());
}

// ---------------------------------------------------------------- sameDraft, byName (review)

#[test]
fn is_the_same_season_with_events_and_filled_prices_in_any_order_blanks_ignored() {
    let a = draft();
    let reordered = SeasonDraft {
        event_ids: vec!["e2".into(), "e1".into()],
        prices: prices(&[(UPPER, "60.00"), (LOWER, "100.00"), ("x", " ")]),
        ..a.clone()
    };
    assert!(same_draft(&a, &reordered));
    let renamed = SeasonDraft {
        name: "Other".into(),
        ..a.clone()
    };
    assert!(!same_draft(&a, &renamed));
    let fewer_prices = SeasonDraft {
        prices: prices(&[(LOWER, "100.00")]),
        ..a.clone()
    };
    assert!(!same_draft(&a, &fewer_prices));
    let fewer_events = SeasonDraft {
        event_ids: vec!["e1".into()],
        ..a.clone()
    };
    assert!(!same_draft(&a, &fewer_events));
    let trimmed = SeasonDraft {
        prices: prices(&[(LOWER, " 100.00 "), (UPPER, "60.00")]),
        ..a.clone()
    };
    assert!(same_draft(&a, &trimmed));
}

#[test]
fn orders_names_by_their_lower_case_characters_as_the_react_app_does() {
    let mut names = vec!["vip", "General", "Éclair", "balcony", "general b"];
    names.sort_by(|a, b| by_name(a, b));
    assert_eq!(names, ["balcony", "General", "general b", "vip", "Éclair"]);
}

// ---------------------------------------------------------------- pickableEvents (R11)

const NOW: &str = "2026-12-01T12:00:00Z";

fn now_ms() -> i64 {
    parse_instant(NOW).unwrap().timestamp_millis()
}

fn ev(id: &str) -> PickerEvent {
    PickerEvent {
        id: id.into(),
        name: id.into(),
        location_id: VENUE.into(),
        layout_id: Some(LAYOUT.into()),
        status: "SCHEDULED".into(),
        starts_at: "2026-12-11T00:00:00Z".into(),
        season: None,
    }
}

fn ids(events: &[PickerEvent]) -> Vec<&str> {
    events.iter().map(|e| e.id.as_str()).collect()
}

#[test]
fn lists_upcoming_scheduled_events_at_the_venue_on_the_layout_not_in_another_season_by_start() {
    let events = vec![
        PickerEvent {
            starts_at: "2026-12-20T00:00:00Z".into(),
            ..ev("later")
        },
        ev("ok"),
        PickerEvent {
            location_id: "other".into(),
            ..ev("elsewhere")
        },
        PickerEvent {
            layout_id: Some("other".into()),
            ..ev("other-layout")
        },
        PickerEvent {
            layout_id: None,
            ..ev("ga")
        },
        PickerEvent {
            status: "CANCELLED".into(),
            ..ev("cancelled")
        },
        PickerEvent {
            starts_at: "2026-12-01T12:00:00Z".into(),
            ..ev("started")
        },
        PickerEvent {
            season: Some(SeasonRef {
                id: "other-season".into(),
                name: "Winter".into(),
            }),
            ..ev("taken")
        },
        PickerEvent {
            season: Some(SeasonRef {
                id: "this".into(),
                name: "This".into(),
            }),
            ..ev("mine")
        },
    ];
    let picked = pickable_events(
        &events,
        &PickOptions {
            location_id: VENUE.into(),
            layout_id: Some(LAYOUT.into()),
            season_id: Some("this".into()),
            now_ms: now_ms(),
            keep: vec![],
        },
    );
    assert_eq!(ids(&picked), ["mine", "ok", "later"]);
}

#[test]
fn lists_general_admission_events_for_a_general_admission_season_and_keeps_chosen_ones() {
    let events = vec![
        PickerEvent {
            layout_id: None,
            ..ev("ga")
        },
        ev("seated"),
        PickerEvent {
            layout_id: None,
            status: "CANCELLED".into(),
            ..ev("old")
        },
    ];
    let picked = pickable_events(
        &events,
        &PickOptions {
            location_id: VENUE.into(),
            layout_id: None,
            season_id: None,
            now_ms: now_ms(),
            keep: vec!["old".into()],
        },
    );
    let mut got = ids(&picked);
    got.sort_unstable();
    assert_eq!(got, ["ga", "old"]);
}

// ---------------------------------------------------------------- seasonStatusText, sportTeamText

fn clock(status: SeasonStatus, sales_end_at: &str, presale: Option<&str>) -> SeasonClock {
    SeasonClock {
        status,
        sales_end_at: parse_instant(sales_end_at).unwrap(),
        single_sales_open_at: presale.map(|p| parse_instant(p).unwrap()),
        time_zone: ZONE.into(),
    }
}

#[test]
fn says_draft_on_sale_presale_until_sales_ended_cancelled() {
    let end = "2026-12-10T23:00:00Z";
    let now = now_ms();
    assert_eq!(
        season_status_text(&clock(SeasonStatus::Draft, end, None), now),
        "Draft"
    );
    assert_eq!(
        season_status_text(&clock(SeasonStatus::OnSale, end, None), now),
        "On sale"
    );
    assert_eq!(
        season_status_text(
            &clock(SeasonStatus::OnSale, end, Some("2026-12-04T15:00:00Z")),
            now
        ),
        "Presale until Dec 4, 2026, 10:00 AM EST"
    );
    assert_eq!(
        season_status_text(
            &clock(SeasonStatus::OnSale, end, Some("2026-11-30T15:00:00Z")),
            now
        ),
        "On sale"
    );
    assert_eq!(
        season_status_text(&clock(SeasonStatus::OnSale, NOW, None), now),
        "Sales ended"
    );
    assert_eq!(
        season_status_text(&clock(SeasonStatus::Cancelled, end, None), now),
        "Cancelled"
    );
}

#[test]
fn shows_the_sport_and_team_together_or_a_dash() {
    assert_eq!(
        sport_team_text(Some("BASKETBALL"), Some("Louisville Cardinals")),
        "Basketball · Louisville Cardinals"
    );
    assert_eq!(sport_team_text(None, None), "—");
    assert_eq!(sport_team_text(Some("BASKETBALL"), Some("")), "—");
    assert_eq!(sport_team_text(Some("CURLING"), Some("Team")), "—");
}

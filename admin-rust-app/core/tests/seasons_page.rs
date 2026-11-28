//! Spec 041 T021, T022, T032 (FR-005, FR-008, FR-014, FR-017, FR-018; research R11, R12): what
//! the Seasons list and a Season's page show and work out, as `admin-app/src/pages/Seasons.tsx`
//! and `SeasonForm.tsx` do. Cases of `admin-app/test/Seasons.test.tsx` and `SeasonForm.test.tsx`,
//! played on the page's figures instead of its markup, from the React app's Season fixture
//! (`tests/fixtures/api/Season.json`, made from `fixtures-041.ts`).

use std::{fs, path::PathBuf};

use admin_rust_core::api::types;
use admin_rust_core::forms::season::{GENERAL_ADMISSION, PreviewLevel, SeasonDraft};
use admin_rust_core::pages::event_page::{DeleteKind, delete_confirm};
use admin_rust_core::pages::seasons::{
    LayoutLevels, PickerEvent, SeasonRef, SeasonRow, cancel_season_confirm, draft_of, figures_line,
    no_prices_note, offered_events, offered_tier_names, on_sale_text, picker_label,
    preview_context, price_label, saved_price_keys, season_cancelled_text, season_lock,
    seasons_count, sport_label,
};
use admin_rust_core::time::parse_instant;
use serde_json::{Value, json};

const SEASON_ID: &str = "c0000000-0000-4000-8000-00000000000c";
const VENUE: &str = "6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e";
const LAYOUT: &str = "0f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f70";
const OTHER_LAYOUT: &str = "1f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f71";
const LOWER: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPPER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GAME_1: &str = "e1000000-0000-4000-8000-000000000001";
const GAME_2: &str = "e1000000-0000-4000-8000-000000000002";
const GAME_3: &str = "e1000000-0000-4000-8000-000000000003";

/// `fixTimeBeforeFixtures`' now (the React tests' clock), before every fixture time.
fn now_ms() -> i64 {
    parse_instant("2026-09-25T12:00:00Z")
        .unwrap()
        .timestamp_millis()
}

fn season_json() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/api/Season.json");
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// The fixture with `over`'s fields replaced, as `season(over)` in `fixtures-041.ts`.
fn season(over: Value) -> types::Season {
    let mut s = season_json();
    for (k, v) in over.as_object().unwrap() {
        s[k] = v.clone();
    }
    serde_json::from_value(s).unwrap()
}

/// `fixtures-041.ts`' default `season()`: a draft, nothing sold, no presale.
fn draft_season() -> types::Season {
    season(json!({
        "status": "DRAFT",
        "singleSalesOpenAt": null,
        "maxPassesPerCustomer": null,
        "salesOpen": false,
        "publishedAt": null,
        "passesSold": 0,
        "passRevenue": "0.00",
    }))
}

// ---------------------------------------------------------------- Seasons.test.tsx

#[test]
fn shows_each_season_name_venue_sport_and_team_events_status_passes_sold_pass_revenue() {
    let rows: Vec<SeasonRow> = [
        season(json!({
            "status": "ON_SALE",
            "singleSalesOpenAt": "2026-09-28T14:00:00.000Z",
            "passesSold": 3,
            "passRevenue": "480.00",
        })),
        season(json!({
            "id": "c2000000-0000-4000-8000-000000000002",
            "name": "Concert Series", "sport": null, "team": null, "events": [],
            "status": "DRAFT", "passesSold": 0, "passRevenue": "0.00",
        })),
        season(json!({ "name": "Old Season", "status": "CANCELLED" })),
        season(json!({
            "name": "Done Season", "status": "ON_SALE", "salesEndAt": "2026-09-20T00:00:00Z",
        })),
        season(json!({ "name": "Open Season", "status": "ON_SALE", "singleSalesOpenAt": null })),
        season(json!({ "passesSold": null, "passRevenue": null })),
    ]
    .iter()
    .map(|s| SeasonRow::of(s, now_ms()))
    .collect();
    let cells = |r: &SeasonRow| {
        vec![
            r.name.clone(),
            r.venue.clone(),
            r.sport_team.clone(),
            r.events.clone(),
            r.status.clone(),
            r.passes_sold.clone(),
            r.pass_revenue.clone(),
        ]
    };
    assert_eq!(
        cells(&rows[0]),
        [
            "Spring Hoops",
            "KFC Yum! Center",
            "Basketball · Louisville Cardinals",
            "2",
            "Presale until Sep 28, 2026, 10:00 AM EDT",
            "3",
            "$480.00",
        ]
    );
    assert_eq!(
        cells(&rows[1]),
        [
            "Concert Series",
            "KFC Yum! Center",
            "—",
            "0",
            "Draft",
            "0",
            "$0.00"
        ]
    );
    assert_eq!(rows[2].status, "Cancelled");
    assert_eq!(rows[3].status, "Sales ended");
    assert_eq!(rows[4].status, "On sale");
    // A customer's read has no figures: shown as none.
    assert_eq!(
        (rows[5].passes_sold.as_str(), rows[5].pass_revenue.as_str()),
        ("0", "$0.00")
    );
    assert_eq!(rows[0].href, format!("/seasons/{SEASON_ID}"));
    assert_eq!(seasons_count(5), "5 seasons");
    assert_eq!(seasons_count(1), "1 season");
    assert_eq!(seasons_count(0), "0 seasons");
}

#[test]
fn passes_sold_are_grouped_as_the_page_writes_them() {
    let s = season(json!({ "passesSold": 12345, "passRevenue": "1234567.50" }));
    let row = SeasonRow::of(&s, now_ms());
    assert_eq!(row.passes_sold, "12,345");
    assert_eq!(row.pass_revenue, "$1,234,567.50");
}

#[test]
fn every_sport_has_its_words() {
    assert_eq!(sport_label("HOCKEY"), Some("Hockey"));
    assert_eq!(sport_label(""), None);
}

// ---------------------------------------------------------------- SeasonForm.test.tsx

#[test]
fn fills_the_form_from_the_season_in_the_venue_zone_with_its_events_chosen() {
    let d = draft_of(&draft_season());
    assert_eq!(
        d,
        SeasonDraft {
            name: "Spring Hoops".into(),
            location_id: VENUE.into(),
            layout: LAYOUT.into(),
            sport: "BASKETBALL".into(),
            team: "Louisville Cardinals".into(),
            // 22:00Z on Oct 10 is 6:00 PM EDT.
            sales_end_at: "2026-10-10T18:00".into(),
            single_sales_open_at: String::new(),
            max_passes_per_customer: String::new(),
            event_ids: vec![GAME_1.into(), GAME_2.into()],
            prices: [(LOWER, "100.00"), (UPPER, "60.00")]
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    );
    let on_sale = draft_of(&season(json!({})));
    assert_eq!(on_sale.single_sales_open_at, "2026-10-01T10:00");
    assert_eq!(on_sale.max_passes_per_customer, "4");
    assert_eq!(
        saved_price_keys(&draft_season()),
        [format!("prices.{LOWER}"), format!("prices.{UPPER}")]
    );
}

#[test]
fn a_general_admission_season_fills_layout_ga_and_prices_by_name_key() {
    let s = season(json!({
        "layoutId": null, "layoutName": null, "sport": null, "team": null,
        "prices": [{ "levelId": null, "levelName": null, "tierName": "Lawn Seats", "price": "50.00" }],
    }));
    let d = draft_of(&s);
    assert_eq!(d.layout, GENERAL_ADMISSION);
    assert_eq!((d.sport.as_str(), d.team.as_str()), ("", ""));
    assert_eq!(
        d.prices.get("tier:lawn seats").map(String::as_str),
        Some("50.00")
    );
    assert_eq!(saved_price_keys(&s), ["prices.tier:lawn seats"]);
}

fn event(id: &str, name: &str, starts_at: &str) -> PickerEvent {
    PickerEvent {
        id: id.into(),
        name: name.into(),
        location_id: VENUE.into(),
        layout_id: Some(LAYOUT.into()),
        status: "SCHEDULED".into(),
        starts_at: starts_at.into(),
        season: None,
    }
}

/// `GAMES`, `CONCERT`, `TAKEN`, and `SHOW` of `fixtures-041.ts`.
fn listed() -> Vec<PickerEvent> {
    vec![
        event(GAME_1, "Cardinals vs. Miami", "2026-10-10T23:00:00.000Z"),
        event(GAME_2, "Cardinals vs. Virginia", "2026-10-17T23:00:00.000Z"),
        event(GAME_3, "Cardinals vs. Syracuse", "2026-10-24T23:00:00.000Z"),
        PickerEvent {
            layout_id: Some(OTHER_LAYOUT.into()),
            ..event(
                "e1000000-0000-4000-8000-000000000004",
                "Arena Tour",
                "2026-10-12T00:00:00.000Z",
            )
        },
        PickerEvent {
            season: Some(SeasonRef {
                id: "f0000000-0000-4000-8000-00000000000f".into(),
                name: "Another Season".into(),
            }),
            ..event(
                "e1000000-0000-4000-8000-000000000005",
                "Cardinals vs. Duke",
                "2026-10-20T23:00:00.000Z",
            )
        },
        PickerEvent {
            layout_id: None,
            ..event(
                "e1000000-0000-4000-8000-000000000006",
                "Comedy Night",
                "2026-10-14T00:00:00.000Z",
            )
        },
    ]
}

fn names(events: &[PickerEvent]) -> Vec<&str> {
    events.iter().map(|e| e.name.as_str()).collect()
}

#[test]
fn lists_only_upcoming_scheduled_events_at_the_venue_on_the_layout_and_in_no_other_season() {
    let new = SeasonDraft {
        location_id: VENUE.into(),
        layout: LAYOUT.into(),
        ..SeasonDraft::default()
    };
    assert_eq!(
        names(&offered_events(&listed(), None, &new, now_ms())),
        [
            "Cardinals vs. Miami",
            "Cardinals vs. Virginia",
            "Cardinals vs. Syracuse"
        ]
    );
    let ga = SeasonDraft {
        layout: GENERAL_ADMISSION.into(),
        ..new.clone()
    };
    assert_eq!(
        names(&offered_events(&listed(), None, &ga, now_ms())),
        ["Comedy Night"]
    );
    // Nothing until both a venue and a layout are chosen.
    let no_layout = SeasonDraft {
        layout: String::new(),
        ..new
    };
    assert!(offered_events(&listed(), None, &no_layout, now_ms()).is_empty());
}

#[test]
fn a_seasons_own_events_stay_listed_though_started_or_cancelled_since() {
    let s = season(json!({
        "events": [
            { "id": GAME_1, "name": "Cardinals vs. Miami", "startsAt": "2026-09-20T23:00:00.000Z",
              "endsAt": "2026-09-21T02:00:00.000Z", "status": "CANCELLED" },
            { "id": GAME_2, "name": "Cardinals vs. Virginia", "startsAt": "2026-10-17T23:00:00.000Z",
              "endsAt": "2026-10-18T02:00:00.000Z", "status": "SCHEDULED" },
        ],
    }));
    let mut events = listed();
    // The list no longer has the cancelled game; the Season's events are marked as its own.
    events.remove(0);
    events[0].season = Some(SeasonRef {
        id: SEASON_ID.into(),
        name: "Spring Hoops".into(),
    });
    let d = draft_of(&s);
    let offered = offered_events(&events, Some(&s), &d, now_ms());
    assert_eq!(
        names(&offered),
        [
            "Cardinals vs. Miami",
            "Cardinals vs. Virginia",
            "Cardinals vs. Syracuse"
        ]
    );
    assert_eq!(offered[0].status, "CANCELLED");
    assert_eq!(
        picker_label(&offered[1], "America/New_York"),
        "Cardinals vs. Virginia · Oct 17, 2026, 7:00 PM EDT"
    );
    // At another venue, the Season's own are not kept.
    let moved = SeasonDraft {
        location_id: "99999999-9999-4999-8999-999999999999".into(),
        ..d
    };
    assert!(offered_events(&events, Some(&s), &moved, now_ms()).is_empty());
}

#[test]
fn gives_each_ticket_type_name_every_chosen_event_sells_a_price_box() {
    let lists = vec![
        vec!["General".to_string(), "VIP".into(), "Lawn".into()],
        vec!["general".to_string(), "Lawn".into()],
    ];
    assert_eq!(offered_tier_names(&lists, &[]), ["General", "Lawn"]);
    // A name the Season already prices stays, once, ignoring case.
    assert_eq!(
        offered_tier_names(&lists, &["Balcony".into(), "LAWN".into()]),
        ["Balcony", "General", "Lawn"]
    );
    assert!(offered_tier_names(&[], &[]).is_empty());
}

#[test]
fn a_price_box_is_named_by_its_level_or_ticket_type() {
    let levels = vec![PreviewLevel {
        id: LOWER.into(),
        name: "Lower".into(),
        rank: 1,
    }];
    assert_eq!(price_label(LOWER, true, &levels, &[]), "Lower pass price");
    assert_eq!(
        price_label(UPPER, true, &levels, &[]),
        format!("{UPPER} pass price")
    );
    let names = vec!["Lawn Seats".to_string()];
    assert_eq!(
        price_label("tier:lawn seats", false, &[], &names),
        "Lawn Seats pass price"
    );
    assert_eq!(
        price_label("tier:gone", false, &[], &names),
        "tier:gone pass price"
    );
    assert_eq!(no_prices_note(""), "Choose a layout to price its levels.");
    assert_eq!(
        no_prices_note(GENERAL_ADMISSION),
        "Choose events to price the ticket types they all sell."
    );
    assert_eq!(no_prices_note(LAYOUT), "Loading the layout’s price levels…");
}

#[test]
fn the_checks_read_the_chosen_events_and_whether_the_season_is_on_sale() {
    let chosen = &listed()[..2];
    let ctx = preview_context("America/New_York", chosen, &[], &[], true, false);
    assert_eq!(ctx.events.len(), 2);
    assert_eq!(ctx.events[0].name, "Cardinals vs. Miami");
    assert!(ctx.complete && !ctx.publishing);
    // Review 041: Put on sale checks the publish rules first, on a context saying so.
    let publishing = preview_context("America/New_York", &chosen[..1], &[], &[], true, true);
    assert!(publishing.complete && publishing.publishing);
}

#[test]
fn locks_once_a_pass_is_sold_saying_why_and_states_the_figures() {
    assert_eq!(
        season_lock::PASSES,
        "Passes have been sold, so the events, venue and layout can't change."
    );
    assert_eq!(
        season_lock::CANCELLED,
        "This season is cancelled, so it can no longer be changed."
    );
    assert_eq!(
        figures_line(Some(1), Some("160.00")),
        "1 pass sold · $160.00 pass revenue"
    );
    assert_eq!(
        figures_line(None, None),
        "0 passes sold · $0.00 pass revenue"
    );
}

#[test]
fn deletes_a_draft_after_confirming_and_cancels_naming_the_passes_to_refund() {
    assert_eq!(
        delete_confirm(DeleteKind::Season, "Spring Hoops"),
        "Delete the season \"Spring Hoops\"? This cannot be undone."
    );
    assert_eq!(
        cancel_season_confirm("Spring Hoops", Some(1)),
        "Cancel \"Spring Hoops\"? 1 pass will be refunded: every order bought on a pass refunded \
         and its tickets voided. Its events stay scheduled. This cannot be undone."
    );
    assert!(cancel_season_confirm("Spring Hoops", Some(2)).contains("2 passes will be refunded"));
    let done: types::SeasonCancellation = serde_json::from_value(json!({
        "season": season(json!({ "status": "CANCELLED" })),
        "passesRefunded": 1,
        "ordersRefunded": 1,
        "ticketsVoided": 2,
    }))
    .unwrap();
    assert_eq!(
        season_cancelled_text(&done),
        "Spring Hoops is cancelled. 1 pass refunded, 1 order refunded, 2 tickets voided."
    );
    assert_eq!(on_sale_text("Spring Hoops"), "Spring Hoops is on sale.");
}

#[test]
fn the_layouts_levels_are_read_from_get_venue_layout() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/api/LayoutDetail.json");
    let detail: LayoutLevels = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let levels = detail.preview();
    assert!(!levels.is_empty());
    assert_eq!(levels[0].name, detail.levels[0].name);
    assert_eq!(levels[0].rank, detail.levels[0].rank);
}

//! Spec 037 (tasks T061–T063; parity E9–E11, E14): the event page's texts, tier bodies, sales
//! cells, and gallery arithmetic, with the cases of `admin-app/test/EventDetail.test.tsx`,
//! `cancel.test.tsx`, `delete-flows.event.test.tsx`, `tiers.test.tsx`, and
//! `packages/shared/test/web/gallery-size.test.ts` and `use-gallery-rotation.test.ts`.

use admin_rust_core::pages::event_page::{
    DeleteKind, GalleryVariant, TierDraft, allocated_line, already_gone_notice, cancel_confirm,
    cancel_done, checked_in_line, count_line, delete_confirm, deleted_notice, gallery_box_height,
    height_style, image_alt, image_position, js_number_of, json_number_of, level_price_cell,
    level_sold_cell, per_customer, remove_tier_confirm, season_link, single_sales_line, sold_line,
    step_index, tier_create_body, tier_sold_cell, tier_update_body, view_button_label,
    wanted_around,
};
use serde_json::json;

#[test]
fn per_customer_reads_no_limit_or_the_count() {
    assert_eq!(per_customer(None), "No limit");
    assert_eq!(per_customer(Some(1)), "1 ticket");
    assert_eq!(per_customer(Some(4)), "4 tickets");
    assert_eq!(per_customer(Some(1200)), "1,200 tickets");
}

#[test]
fn cancel_texts_match_the_react_page() {
    assert_eq!(
        cancel_confirm("Season Opener"),
        "Cancel \"Season Opener\"? Every ticket will be voided and every order refunded. This cannot be undone."
    );
    assert_eq!(
        cancel_done(3, 7),
        "Cancelled. 3 orders refunded, 7 tickets voided."
    );
    assert_eq!(
        cancel_done(1, 1),
        "Cancelled. 1 order refunded, 1 ticket voided."
    );
    assert_eq!(
        cancel_done(0, 0),
        "Cancelled. 0 orders refunded, 0 tickets voided."
    );
}

#[test]
fn delete_texts_match_use_delete() {
    assert_eq!(
        delete_confirm(DeleteKind::Event, "Season Opener"),
        "Delete the event \"Season Opener\"? This cannot be undone."
    );
    assert_eq!(
        delete_confirm(DeleteKind::Venue, "Hall"),
        "Delete the venue \"Hall\"? This cannot be undone."
    );
    assert_eq!(
        deleted_notice("Season Opener"),
        "Deleted \"Season Opener\"."
    );
    assert_eq!(
        already_gone_notice("Season Opener"),
        "\"Season Opener\" no longer exists. The list has been refreshed."
    );
}

#[test]
fn tier_texts() {
    assert_eq!(
        remove_tier_confirm("VIP"),
        "Remove the tier \"VIP\"? This cannot be undone."
    );
    assert_eq!(allocated_line(900, 1000), "Allocated 900 of 1,000 tickets");
    assert_eq!(allocated_line(0, 5), "Allocated 0 of 5 tickets");
}

#[test]
fn number_of_reads_as_javascript_number() {
    assert_eq!(js_number_of(""), Some(0.0));
    assert_eq!(js_number_of("  "), Some(0.0));
    assert_eq!(js_number_of("500"), Some(500.0));
    assert_eq!(js_number_of(" 12 "), Some(12.0));
    assert_eq!(js_number_of("1.5"), Some(1.5));
    assert_eq!(js_number_of("1e3"), Some(1000.0));
    assert_eq!(js_number_of("abc"), None);
    assert_eq!(js_number_of("inf"), None);
    assert_eq!(json_number_of("500"), json!(500));
    assert_eq!(json_number_of("1.5"), json!(1.5));
    assert_eq!(json_number_of(""), json!(0));
    assert_eq!(json_number_of("x"), json!(null));
}

#[test]
fn a_new_tier_sends_the_typed_values() {
    let draft = TierDraft {
        name: "VIP".into(),
        price: "250.00".into(),
        quantity: "100".into(),
    };
    assert_eq!(
        tier_create_body(&draft),
        json!({ "name": "VIP", "price": "250.00", "quantity": 100 })
    );
}

#[test]
fn an_edit_sends_only_what_changed() {
    let start = TierDraft::of("General", "120.00", 800);
    assert_eq!(start.quantity, "800");
    assert_eq!(
        tier_update_body("General", "120.00", 800, &start, false),
        json!({})
    );
    let changed = TierDraft {
        quantity: "150".into(),
        ..start.clone()
    };
    assert_eq!(
        tier_update_body("General", "120.00", 800, &changed, false),
        json!({ "quantity": 150 })
    );
    let renamed = TierDraft {
        name: "Floor".into(),
        price: "99".into(),
        ..start.clone()
    };
    assert_eq!(
        tier_update_body("General", "120.00", 800, &renamed, false),
        json!({ "name": "Floor", "price": "99" })
    );
    // A seated event's quantity is text only and never sent.
    assert_eq!(
        tier_update_body("General", "120.00", 800, &changed, true),
        json!({})
    );
    // An emptied number input is Number("") = 0, sent as it is (the Backend refuses it).
    let emptied = TierDraft {
        quantity: String::new(),
        ..start
    };
    assert_eq!(
        tier_update_body("General", "120.00", 800, &emptied, false),
        json!({ "quantity": 0 })
    );
}

#[test]
fn sales_cells() {
    assert_eq!(sold_line(25, 100), "25 of 100 tickets sold");
    assert_eq!(sold_line(0, 1000), "0 of 1,000 tickets sold");
    assert_eq!(checked_in_line(1234), "1,234 checked in");
    assert_eq!(tier_sold_cell(10, 1000), "10 of 1,000");
    assert_eq!(level_price_cell(Some("95.00")), "$95.00");
    assert_eq!(level_price_cell(None), "—");
    assert_eq!(level_sold_cell(false, 40, 1200), "40 of 1,200");
    assert_eq!(level_sold_cell(true, 3, 0), "3");
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.01
}

#[test]
fn card_height_follows_the_shape_between_3_4_and_2_1() {
    let card = |w: f64, r: Option<f64>| gallery_box_height(GalleryVariant::Card, w, r, 900.0);
    for (ratio, height) in [
        (Some(4.0 / 3.0), 240.0),
        (Some(1.0), 320.0),
        (None, 240.0),
        (Some(0.8), 400.0),
        (Some(0.75), 426.67),
        (Some(0.5), 426.67),
        (Some(1.9), 168.42),
        (Some(2.0), 160.0),
        (Some(3.0), 160.0),
    ] {
        assert!(close(card(320.0, ratio), height), "{ratio:?}");
    }
    for (w, ratio, height) in [
        (263.0, Some(3.0), 160.0),
        (300.0, Some(2.0), 160.0),
        (330.0, Some(2.0), 165.0),
        (200.0, None, 160.0),
    ] {
        assert!(close(card(w, ratio), height), "{w} {ratio:?}");
    }
}

#[test]
fn page_height_is_200_to_70_percent_of_the_window() {
    let page = |w: f64, r: Option<f64>| gallery_box_height(GalleryVariant::Page, w, r, 900.0);
    for (w, ratio, height) in [
        (1280.0, Some(16.0 / 9.0), 630.0),
        (1280.0, Some(1280.0 / 640.0), 630.0),
        (1280.0, Some(1280.0 / 630.0), 630.0),
        (1280.0, Some(1280.0 / 620.0), 620.0),
        (1280.0, Some(3.0), 426.67),
        (1280.0, Some(1280.0 / 210.0), 210.0),
        (1280.0, Some(6.4), 200.0),
        (1280.0, Some(10.0), 200.0),
        (1280.0, None, 480.0),
        (375.0, None, 200.0),
    ] {
        assert!(close(page(w, ratio), height), "{w} {ratio:?}");
    }
    assert_eq!(
        gallery_box_height(GalleryVariant::Page, 1280.0, Some(1.0), 250.0),
        200.0
    );
    assert_eq!(height_style(312.5), "312.5px");
    assert_eq!(height_style(480.0), "480px");
}

#[test]
fn rotation_wraps_both_ways() {
    assert_eq!(step_index(0, 1, 3), 1);
    assert_eq!(step_index(2, 1, 3), 0);
    assert_eq!(step_index(0, -1, 3), 2);
    assert_eq!(step_index(0, 1, 0), 0);
    assert_eq!(wanted_around(2, 3, &[0, 1]), vec![2, 0]);
    assert_eq!(wanted_around(0, 3, &[0, 1, -1]), vec![0, 1, 2]);
    assert_eq!(wanted_around(0, 0, &[0, 1]), Vec::<usize>::new());
}

#[test]
fn gallery_names() {
    assert_eq!(image_position(1, 5), "image 2 of 5");
    assert_eq!(count_line(1, 5), "2 of 5");
    assert_eq!(
        view_button_label("Season Opener", 0, 3),
        "View Season Opener, image 1 of 3, full screen"
    );
    assert_eq!(
        image_alt("Season Opener", 2, 3),
        "Season Opener, image 3 of 3"
    );
}

#[test]
fn an_event_in_a_season_names_it_linked_and_says_when_single_tickets_go_on_sale() {
    // Spec 041 FR-013, FR-019 (T040; `event-season.test.tsx`): in the venue's zone.
    assert_eq!(
        season_link("c0000000-0000-4000-8000-00000000000c"),
        "/seasons/c0000000-0000-4000-8000-00000000000c"
    );
    assert_eq!(
        single_sales_line("2026-09-28T14:00:00.000Z", Some("America/New_York")),
        "Single tickets on sale from Sep 28, 2026, 10:00 AM EDT"
    );
    assert_eq!(
        single_sales_line("2026-09-28T14:00:00.000Z", Some("America/Chicago")),
        "Single tickets on sale from Sep 28, 2026, 9:00 AM CDT"
    );
    // No zone is Eastern, as `when` reads it.
    assert_eq!(
        single_sales_line("2026-12-01T15:00:00Z", None),
        "Single tickets on sale from Dec 1, 2026, 10:00 AM EST"
    );
}

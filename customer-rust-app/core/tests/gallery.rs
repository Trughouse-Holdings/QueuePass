// Copied from admin-rust-app/core/tests/event_page.rs at 680b4f7 (spec 040 R4), the gallery cases.
//! Spec 040 (task T034; parity B6, E3): the gallery arithmetic of
//! `packages/shared/test/web/gallery-size.test.ts` and `use-gallery-rotation.test.ts` (copied with
//! the Rust Admin app's gallery), and the card variant's rules from `image-gallery.test.tsx`
//! ("ImageGallery, card variant"), `customer-app/test/event-images.test.tsx`, and `cards.test.tsx`.

use customer_rust_core::gallery::{
    CARD_MIN_HEIGHT, Direction, GALLERY_INTERVAL_MS, GalleryVariant, NEAR_SCREEN, Pause,
    RotationState, SHOWN_AND_NEIGHBORS, SHOWN_AND_NEXT, SLIDE_MS, card_held, count_line,
    gallery_box_height, gallery_class, height_style, image_alt, image_position, live_politeness,
    rotating, slide_still, step_index, toggle_icon, toggle_label, view_button_label, wanted_around,
};

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.01
}

#[test]
fn constants_match_the_shared_gallery() {
    assert_eq!(GALLERY_INTERVAL_MS, 5_000);
    assert_eq!(SLIDE_MS, 400);
    assert_eq!(SHOWN_AND_NEXT, [0, 1]);
    assert_eq!(SHOWN_AND_NEIGHBORS, [0, 1, -1]);
    assert_eq!(CARD_MIN_HEIGHT, 160.0);
    assert_eq!(NEAR_SCREEN, "200px");
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
    assert_eq!(
        toggle_label(false, "Season Opener"),
        "Pause images of Season Opener"
    );
    assert_eq!(
        toggle_label(true, "Season Opener"),
        "Play images of Season Opener"
    );
    assert_eq!(toggle_icon(false), "❚❚");
    assert_eq!(toggle_icon(true), "▶");
}

// use-gallery-rotation.test.ts: next and prev wrap; a change counts a turn; `show` is a jump.
#[test]
fn the_rotation_state_steps_wraps_and_jumps() {
    let mut r = RotationState::new(3, 0);
    r.step(1);
    assert_eq!((r.index, r.turn, r.direction), (1, 1, Direction::Left));
    r.step(1);
    r.step(1);
    // From the last to the first still slides left.
    assert_eq!((r.index, r.turn, r.direction), (0, 3, Direction::Left));
    r.step(-1);
    assert_eq!((r.index, r.direction), (2, Direction::Right));
    r.show(1);
    assert_eq!((r.index, r.turn), (1, 4));
    // With fewer than 2 images nothing changes.
    let mut one = RotationState::new(1, 0);
    one.step(1);
    assert_eq!((one.index, one.turn), (0, 0));
    // The viewer opens on the gallery's image, clamped.
    assert_eq!(RotationState::new(3, 7).index, 2);
    assert_eq!(Direction::Left.as_str(), "left");
    assert_eq!(Direction::Right.as_str(), "right");
}

// use-gallery-rotation.test.ts and image-gallery.test.tsx: what stops the turning.
#[test]
fn it_turns_only_with_two_images_and_nothing_pausing_it() {
    let none = Pause::default();
    assert!(rotating(3, none, false, false));
    assert!(!rotating(1, none, false, false));
    assert!(!rotating(0, none, false, false));
    // Stopped by Pause/Play, whatever pauses it.
    assert!(!rotating(3, none, true, false));
    // Reduced motion: no timer.
    assert!(!rotating(3, none, false, true));
    for pause in [
        Pause {
            over_arrow: true,
            ..none
        },
        Pause {
            keyboard_focus: true,
            ..none
        },
        Pause {
            off_screen: true,
            ..none
        },
        Pause {
            viewing: true,
            ..none
        },
    ] {
        assert!(pause.any());
        assert!(!rotating(3, pause, false, false), "{pause:?}");
    }
    assert!(!none.any());
}

// "is announced politely only while it does not turn on its own".
#[test]
fn the_live_region_is_polite_only_while_not_turning() {
    assert_eq!(live_politeness(true), "off");
    assert_eq!(live_politeness(false), "polite");
}

// "loads only on or near the screen, holds the shown and next images, and lets go off screen".
#[test]
fn a_card_holds_the_shown_and_next_images_only_on_screen() {
    let held = |i, n, on, from| card_held(i, n, on, from).into_iter().collect::<Vec<_>>();
    assert_eq!(held(0, 5, true, None), vec![0, 1]);
    // During a slide, the outgoing image too: never more than 3.
    assert_eq!(held(1, 5, true, Some(0)), vec![0, 1, 2]);
    assert_eq!(held(4, 5, true, None), vec![0, 4]);
    assert_eq!(held(1, 5, false, Some(0)), Vec::<usize>::new());
    assert_eq!(held(0, 1, true, None), vec![0]);
    assert_eq!(held(0, 0, true, None), Vec::<usize>::new());
    // A slide never starts while off screen or under reduced motion.
    assert!(slide_still(false, false));
    assert!(slide_still(true, true));
    assert!(!slide_still(false, true));
}

#[test]
fn the_gallery_classes_name_the_variant_and_its_state() {
    assert_eq!(
        gallery_class(GalleryVariant::Card, false, false),
        "gallery gallery--card"
    );
    assert_eq!(
        gallery_class(GalleryVariant::Page, true, true),
        "gallery gallery--page gallery--measured gallery--reshaping"
    );
    assert_eq!(
        gallery_class(GalleryVariant::Card, true, false),
        "gallery gallery--card gallery--measured"
    );
    assert_eq!(GalleryVariant::Card.as_str(), "card");
}

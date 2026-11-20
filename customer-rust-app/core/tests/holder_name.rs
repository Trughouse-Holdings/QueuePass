//! Spec 040 T040 (parity P5; spec 017 FR-001 to FR-003): the name on tickets, ported from
//! `packages/shared/test/holder-name.test.ts` and the logic of
//! `customer-app/test/holder-name-field.test.tsx` (when the message shows, how it is linked).

use customer_rust_core::holder_name::{
    HOLDER_NAME_HINT, HOLDER_NAME_MAX, HolderNameField, HolderNameProblem, NAME_NEEDED_TO_BUY,
    holder_name_message, holder_name_problem, name_needed_to_buy, normalize_holder_name,
};

use HolderNameProblem::*;

// ------------------------------------------------------------------ holder-name.test.ts

#[test]
fn blank_names_are_missing() {
    for raw in ["", "   ", "  \t "] {
        assert_eq!(holder_name_problem(raw), Some(Missing), "{raw:?}");
    }
}

#[test]
fn refuses_101_code_points_as_too_long_and_accepts_exactly_100() {
    assert_eq!(HOLDER_NAME_MAX, 100);
    assert_eq!(holder_name_problem(&"a".repeat(101)), Some(TooLong));
    assert_eq!(holder_name_problem(&"a".repeat(100)), None);
    // Emoji: one code point each (two UTF-16 units): counted in code points.
    assert_eq!(holder_name_problem(&format!("a{}", "😀".repeat(99))), None);
    assert_eq!(
        holder_name_problem(&format!("a{}", "😀".repeat(100))),
        Some(TooLong)
    );
}

#[test]
fn control_characters_are_refused() {
    for raw in ["Jordan\tLee", "Jordan\nLee", "Jordan\u{0}Lee"] {
        assert_eq!(holder_name_problem(raw), Some(ControlCharacter), "{raw:?}");
    }
}

#[test]
fn a_name_needs_a_letter() {
    for raw in ["1234", "---"] {
        assert_eq!(holder_name_problem(raw), Some(NoLetter), "{raw:?}");
    }
}

#[test]
fn valid_names_keep_inner_spaces() {
    for raw in [
        "Jordan Lee",
        "José Núñez",
        "李小龙",
        "O'Brien",
        "Ana  María",
    ] {
        assert_eq!(holder_name_problem(raw), None, "{raw:?}");
    }
}

#[test]
fn checks_in_the_order_missing_too_long_control_no_letter() {
    assert_eq!(holder_name_problem(&" ".repeat(200)), Some(Missing));
    assert_eq!(
        holder_name_problem(&format!("\t{}", "a".repeat(101))),
        Some(TooLong)
    );
    assert_eq!(holder_name_problem("12\t34"), Some(ControlCharacter));
}

#[test]
fn normalize_trims_and_keeps_inner_runs() {
    assert_eq!(normalize_holder_name("  Jordan Lee "), "Jordan Lee");
    assert_eq!(normalize_holder_name("Ana  María"), "Ana  María");
}

#[test]
fn normalize_composes_to_nfc() {
    assert_eq!(normalize_holder_name("e\u{301}"), "\u{e9}");
}

#[test]
fn normalize_trims_as_javascript_does() {
    // `String.prototype.trim`: the BOM is white space, NEL (U+0085) is not.
    assert_eq!(normalize_holder_name("\u{feff}Ana\u{3000}"), "Ana");
    assert_eq!(normalize_holder_name("\u{85}Ana"), "\u{85}Ana");
    assert_eq!(holder_name_problem("\u{85}Ana"), Some(ControlCharacter));
}

#[test]
fn a_letter_is_a_letter_of_any_script_but_not_a_mark_or_number() {
    assert_eq!(holder_name_problem("\u{301}"), Some(NoLetter));
    assert_eq!(holder_name_problem("Ⅻ"), Some(NoLetter)); // Nl, not L
    assert_eq!(holder_name_problem("ß"), None);
}

#[test]
fn one_message_per_problem() {
    assert_eq!(
        holder_name_message(Missing),
        "Enter the name on your photo ID."
    );
    assert_eq!(
        holder_name_message(TooLong),
        "The name can be at most 100 characters."
    );
    assert_eq!(
        holder_name_message(ControlCharacter),
        "The name can't contain tabs or line breaks."
    );
    assert_eq!(
        holder_name_message(NoLetter),
        "The name on the tickets must contain at least one letter."
    );
}

// ------------------------------------------------------------------ holder-name-field.test.tsx

#[test]
fn the_hint_is_the_react_text() {
    assert_eq!(
        HOLDER_NAME_HINT,
        "Your name, as on the photo ID you'll show at the gate. It goes on every ticket."
    );
}

#[test]
fn no_message_until_the_field_was_left() {
    let mut field = HolderNameField::default();
    assert!(!field.valid());
    assert_eq!(field.error(), None);
    assert_eq!(field.described_by(), "holder-name-hint");
    assert!(!field.invalid());
    field.leave();
    assert_eq!(
        field.error().as_deref(),
        Some("Enter the name on your photo ID.")
    );
    assert_eq!(field.described_by(), "holder-name-hint holder-name-error");
    assert!(field.invalid());
}

#[test]
fn the_message_goes_once_the_name_is_fixed() {
    let mut field = HolderNameField::default();
    field.set("1234");
    field.leave();
    assert_eq!(
        field.error().as_deref(),
        Some("The name on the tickets must contain at least one letter.")
    );
    field.set("Jordan Lee");
    assert!(field.valid());
    assert_eq!(field.error(), None);
    assert_eq!(field.described_by(), "holder-name-hint");
    // The name is sent as typed (the Backend normalizes it).
    assert_eq!(field.value(), "Jordan Lee");
}

// ------------------------------------------------------------------ issue #182

/// The same words as the React Customer app's (`packages/shared/src/holder-name.ts`), read from
/// that file so the two cannot drift apart (spec 040).
#[test]
fn name_needed_to_buy_is_the_shared_text() {
    assert_eq!(
        NAME_NEEDED_TO_BUY,
        "Enter the name on tickets above to buy."
    );
    let ts = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/shared/src/holder-name.ts"
    ))
    .expect("read packages/shared/src/holder-name.ts");
    assert!(
        ts.contains(&format!(
            "export const NAME_NEEDED_TO_BUY = '{NAME_NEEDED_TO_BUY}';"
        )),
        "holder-name.ts' NAME_NEEDED_TO_BUY differs"
    );
}

#[test]
fn name_needed_to_buy_shows_only_while_the_name_is_the_one_thing_missing() {
    // No valid name, usable with one, no wait: the line.
    assert_eq!(
        name_needed_to_buy(false, true, false),
        Some(NAME_NEEDED_TO_BUY)
    );
    // A valid name: nothing to say.
    assert_eq!(name_needed_to_buy(true, true, false), None);
    // Something else blocks it too (buying, nothing chosen, sold out).
    assert_eq!(name_needed_to_buy(false, false, false), None);
    // The BUY wait shows its own message.
    assert_eq!(name_needed_to_buy(false, true, true), None);
}

#[test]
fn the_field_says_when_the_name_is_needed() {
    let mut f = HolderNameField::default();
    assert_eq!(f.needed_to_buy(true, false), Some(NAME_NEEDED_TO_BUY));
    f.set("   ");
    assert_eq!(f.needed_to_buy(true, false), Some(NAME_NEEDED_TO_BUY));
    f.set("1234");
    assert_eq!(f.needed_to_buy(true, false), Some(NAME_NEEDED_TO_BUY));
    f.set("Jordan Lee");
    assert_eq!(f.needed_to_buy(true, false), None);
}

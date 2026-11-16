// Copied from admin-rust-app/core/tests/theme.rs at 680b4f7 (spec 040 R4).
//! Spec 040 research R6 (task T023): the Rust Customer app links the Rust Admin app's own
//! `style/red.css` over the React Customer app's stylesheets, so this test reads that file where
//! it lives; a change to it that breaks the Customer screens fails here. From spec 037 R8, R9
//! (tasks T030): the red look. `style/red.css` redefines exactly the 14
//! look tokens of the shared theme, light and dark, and nothing else, and holds only custom
//! properties. With its values over the shared theme's, every text and control pair the shared
//! contrast test checks still passes WCAG AA (packages/shared/test/theme/contrast.test.ts).

use std::{fs, path::PathBuf};

use customer_rust_core::theme::{
    LOOK_TOKENS, Resolved, Scheme, ThemeTokens, contrast, custom_properties_only, parse_tokens,
};

fn repo(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn shared() -> ThemeTokens {
    parse_tokens(&repo("packages/shared/src/web/theme.css"))
}

fn red() -> ThemeTokens {
    parse_tokens(&repo("admin-rust-app/style/red.css"))
}

/// The shared theme with red.css loaded after it, as the browser applies them.
fn applied(scheme: Scheme) -> Resolved {
    shared().with(&red()).scheme(scheme)
}

#[test]
fn the_look_tokens_are_the_fourteen_of_r8() {
    assert_eq!(
        LOOK_TOKENS,
        [
            "bg",
            "surface",
            "surface-alt",
            "border",
            "border-strong",
            "text",
            "text-muted",
            "text-faint",
            "accent",
            "accent-hover",
            "accent-soft",
            "accent-text",
            "brand-mark-end",
            "brand-mark-text",
        ]
    );
}

#[test]
fn red_redefines_exactly_the_look_tokens_in_light_and_dark() {
    let red = red();
    let mut light: Vec<&str> = red.light.keys().map(String::as_str).collect();
    let mut dark: Vec<&str> = red.dark.keys().map(String::as_str).collect();
    let mut look = LOOK_TOKENS.to_vec();
    light.sort();
    dark.sort();
    look.sort();
    assert_eq!(light, look, "light set");
    assert_eq!(dark, look, "dark set");
}

#[test]
fn every_look_token_is_one_the_shared_theme_defines_in_both_sets() {
    let shared = shared();
    for token in LOOK_TOKENS {
        assert!(shared.light.contains_key(token), "--{token} light");
        assert!(shared.dark.contains_key(token), "--{token} dark");
    }
}

#[test]
fn no_data_token_is_redefined() {
    let red = red();
    for set in [&red.light, &red.dark] {
        for name in set.keys() {
            for data in [
                "danger", "warn", "ok", "level-", "map-", "seat-", "stone-", "scrim", "qr-",
            ] {
                assert!(
                    !name.starts_with(data),
                    "red.css redefines data token --{name}"
                );
            }
        }
    }
}

#[test]
fn red_css_holds_only_custom_properties() {
    assert_eq!(
        custom_properties_only(&repo("admin-rust-app/style/red.css")),
        Ok(())
    );
}

#[test]
fn the_check_refuses_a_selector_rule_or_a_layout_rule() {
    assert!(custom_properties_only(":root { --bg: #fff; }\n.btn { color: red; }").is_err());
    assert!(custom_properties_only(":root { --bg: #fff; margin: 0; }").is_err());
    assert!(
        custom_properties_only("@media (prefers-color-scheme: dark) { :root { --bg: #000; } }")
            .is_ok()
    );
    assert!(custom_properties_only("@media (max-width: 600px) { :root { --bg: #000; } }").is_err());
}

#[test]
fn the_red_values_are_red() {
    let red = red();
    assert_eq!(red.light["accent"], "#b3261e");
    assert_eq!(red.light["bg"], "#fdecea");
}

#[test]
fn contrast_matches_wcag() {
    assert!((contrast("#000000", "#ffffff") - 21.0).abs() < 1e-9);
    assert!((contrast("#ffffff", "#ffffff") - 1.0).abs() < 1e-9);
    // The shared accent on white, as the shared test computes it.
    assert!((contrast("#4f46e5", "#ffffff") - 6.29).abs() < 0.01);
}

const TEXT: [&str; 6] = ["text", "text-muted", "accent", "danger", "warn", "ok"];
const BACKGROUNDS: [&str; 2] = ["surface", "bg"];

fn check_pairs(scheme: Scheme) {
    let t = applied(scheme);
    let at = |fg: &str, bg: &str, min: f64| {
        let ratio = contrast(&t.get(fg), &t.get(bg));
        assert!(
            ratio >= min,
            "{scheme:?}: --{fg} on --{bg} is {ratio:.2}:1, under {min}:1"
        );
    };
    for fg in TEXT {
        for bg in BACKGROUNDS {
            at(fg, bg, 4.5);
        }
    }
    at("accent-text", "accent", 4.5);
    for (fg, bg) in [
        ("accent", "accent-soft"),
        ("danger", "danger-bg"),
        ("warn", "warn-bg"),
        ("ok", "ok-bg"),
        ("text-muted", "surface-alt"),
        ("text", "surface-alt"),
        ("accent", "warn-bg"),
        ("accent", "danger-bg"),
        ("accent-text", "accent-hover"),
    ] {
        at(fg, bg, 4.5);
    }
    for token in ["border-strong", "accent"] {
        at(token, "surface", 3.0);
    }
    at("border-strong", "bg", 3.0);
    // Focus rings are drawn in the accent: 3:1 on both backgrounds.
    at("accent", "bg", 3.0);
    // The brand mark's "Q" is large bold decoration, so 3:1.
    for bg in ["accent", "brand-mark-end"] {
        at("brand-mark-text", bg, 3.0);
    }
}

#[test]
fn every_pair_passes_aa_in_light() {
    check_pairs(Scheme::Light);
}

#[test]
fn every_pair_passes_aa_in_dark() {
    check_pairs(Scheme::Dark);
}

/// Spec 040 R6: `customer-app/src/styles.css` uses only the look tokens red.css redefines, the
/// layout tokens (space, radius, font), and the QR's two data tokens, so every Customer screen
/// turns red and the QR code keeps its colors.
#[test]
fn the_customer_stylesheet_uses_only_look_layout_and_qr_tokens() {
    let css = repo("customer-app/src/styles.css");
    let mut used: Vec<String> = css
        .split("var(--")
        .skip(1)
        .map(|rest| {
            rest.chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect()
        })
        .collect();
    used.sort();
    used.dedup();
    assert!(!used.is_empty());
    for token in &used {
        let allowed = LOOK_TOKENS.contains(&token.as_str())
            || token.starts_with("space-")
            || token.starts_with("radius")
            || token == "mono"
            || token == "font"
            || token == "qr-dark"
            || token == "qr-light";
        assert!(allowed, "customer-app/src/styles.css uses --{token}");
    }
    // The QR stays dark on light: red.css never touches it (parity S12, T12).
    let red = red();
    assert!(!red.light.contains_key("qr-dark") && !red.dark.contains_key("qr-light"));
}

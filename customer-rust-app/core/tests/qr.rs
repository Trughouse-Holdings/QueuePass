//! Spec 040 T056 (parity T12; research R9): the QR code's modules equal `qrcode-generator`
//! 2.0.4's for the same text (`fixtures/customer/qr.json`, written by
//! `scripts/customer-parity-fixtures.mjs`: printed ticket codes, live codes, and longer texts),
//! and the SVG path is `TicketQr.tsx`' `pathOf`. From `customer-app/test/print-ticket.test.tsx`'
//! `qrMatrix` case: a 12-character code is 21 × 21.

use customer_rust_core::qr::{QUIET_ZONE, qr_matrix, qr_path, qr_size};
use serde_json::Value;

const FIXTURES: &str = include_str!("fixtures/customer/qr.json");

fn rows(matrix: &[Vec<bool>]) -> Vec<String> {
    matrix
        .iter()
        .map(|r| r.iter().map(|d| if *d { '1' } else { '0' }).collect())
        .collect()
}

#[test]
fn every_grid_equals_qrcode_generators() {
    let cases: Vec<Value> = serde_json::from_str(FIXTURES).unwrap();
    assert!(cases.len() >= 9);
    for c in cases {
        let text = c["text"].as_str().unwrap();
        let expected: Vec<String> = c["grid"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap().to_string())
            .collect();
        let got = qr_matrix(text).unwrap_or_else(|| panic!("no matrix for {text}"));
        assert_eq!(rows(&got), expected, "{text}");
    }
}

#[test]
fn a_12_character_code_is_21_by_21_and_a_live_code_33_by_33() {
    assert_eq!(qr_matrix("AAAA2222BBBB").unwrap().len(), 21);
    let live = format!("QP1:{}:58773103:{}", "A".repeat(32), "B".repeat(16));
    assert_eq!(live.len(), 62);
    assert_eq!(qr_matrix(&live).unwrap().len(), 33);
}

#[test]
fn text_outside_the_alphanumeric_set_has_no_matrix() {
    assert_eq!(qr_matrix(&"A".repeat(5000)), None);
    assert_eq!(qr_matrix("qp1:abc"), None);
}

#[test]
fn the_path_draws_each_dark_module_past_the_quiet_zone() {
    let m = vec![vec![true, false], vec![false, true]];
    assert_eq!(QUIET_ZONE, 4);
    assert_eq!(qr_path(&m), "M4 4h1v1h-1zM5 5h1v1h-1z");
    assert_eq!(qr_size(&m), 10);
    assert_eq!(qr_size(&qr_matrix("AAAA2222BBBB").unwrap()), 29);
}

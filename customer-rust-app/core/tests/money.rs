// Copied from admin-rust-app/core/tests/money.rs at 680b4f7 (spec 040 R4).
//! Spec 037 T029: money, in integer cents and decimal strings, never floating point
//! (Constitution, Money).
//!
//! - `admin-app/src/money.ts` `usd`, with the amounts of `admin-app/test/fixtures-005.ts` as the
//!   React Admin pages show them (Reports, Sales, Attendees)
//! - `BASE_PRICE_PATTERN` of `packages/shared/src/event.ts`
//! - `priceCents` and `formatPrice` of `packages/shared/src/web/venue-map/map-state.ts`, with the
//!   cases of `packages/shared/test/venue-map/map-state.test.ts`
//!
//! Expected strings are the TypeScript functions' own outputs under Node 22.

use customer_rust_core::money::{
    BASE_PRICE_PATTERN, format_price, is_base_price, price_cents, usd,
};

mod usd_money_ts {
    use super::*;

    #[test]
    fn shows_the_fixture_amounts_as_the_react_pages_do() {
        for (amount, shown) in [
            // REPORT totals and events
            ("4321.50", "$4,321.50"),
            ("1321.50", "$1,321.50"),
            ("3000.00", "$3,000.00"),
            ("0.00", "$0.00"),
            // tiers
            ("45.00", "$45.00"),
            ("84.30", "$84.30"),
            ("900.00", "$900.00"),
            ("421.50", "$421.50"),
            // ORDERS
            ("168.60", "$168.60"),
        ] {
            assert_eq!(usd(amount), shown, "{amount}");
        }
    }

    #[test]
    fn groups_thousands_and_pads_or_cuts_cents_from_the_string_digits() {
        for (amount, shown) in [
            ("1321.5", "$1,321.50"),
            ("0", "$0.00"),
            ("1200", "$1,200.00"),
            ("1234567.891", "$1,234,567.89"),
            ("45", "$45.00"),
            ("1000000", "$1,000,000.00"),
            ("999.999", "$999.99"),
            (
                "123456789012345678901234567890.12",
                "$123,456,789,012,345,678,901,234,567,890.12",
            ),
        ] {
            assert_eq!(usd(amount), shown, "{amount}");
        }
    }

    #[test]
    fn copies_the_typescript_on_odd_input() {
        for (amount, shown) in [
            ("-1234.5", "$-1,234.50"),
            (".5", "$.50"),
            ("", "$.00"),
            ("12.3.4", "$12.30"),
            ("abc", "$abc.00"),
            ("1234a567", "$1,234a,567.00"),
        ] {
            assert_eq!(usd(amount), shown, "{amount}");
        }
    }
}

mod base_price_pattern {
    use super::*;

    #[test]
    fn is_the_shared_pattern() {
        assert_eq!(BASE_PRICE_PATTERN, r"^\d+(\.\d{1,2})?$");
    }

    #[test]
    fn accepts_a_non_negative_decimal_with_at_most_two_fraction_digits() {
        for price in ["45", "45.0", "45.00", "0", "00012.30", "1200.5"] {
            assert!(is_base_price(price), "{price}");
        }
    }

    #[test]
    fn refuses_anything_else() {
        for price in [
            "45.000", ".5", "45.", "-1", "1,000", " 45", "45 ", "１２", "", "4e2", "45\n",
        ] {
            assert!(!is_base_price(price), "{price:?}");
        }
    }
}

mod price_cents_and_format_price {
    use super::*;

    #[test]
    fn shows_whole_dollars_without_cents() {
        assert_eq!(format_price("95.00"), "$95");
        assert_eq!(format_price("59.50"), "$59.50");
        assert_eq!(format_price("60.50"), "$60.50");
        assert_eq!(format_price("1200.00"), "$1,200");
        assert_eq!(format_price("0.00"), "$0");
        assert_eq!(format_price("1234567.89"), "$1,234,567.89");
        assert_eq!(format_price("5.5"), "$5.50");
        assert_eq!(format_price("1200"), "$1,200");
    }

    #[test]
    fn reads_exact_cents_from_the_digits() {
        for (price, cents) in [
            ("95.00", 9500),
            ("59.50", 5950),
            ("60.50", 6050),
            ("1200.00", 120_000),
            ("0.00", 0),
            ("1200", 120_000),
            (".5", 50),
            ("", 0),
            ("1.234", 123),
            (" 12 ", 1200),
            ("1234567.89", 123_456_789),
            ("5.5", 550),
            // 0.1 + 0.2 never meets a float here.
            ("0.30", 30),
            ("84.30", 8430),
        ] {
            assert_eq!(price_cents(price), Some(cents), "{price:?}");
        }
    }

    #[test]
    fn copies_the_typescript_on_odd_input() {
        assert_eq!(price_cents("-5.50"), Some(-450));
        assert_eq!(format_price("-5.50"), "$-5.-50");
        assert_eq!(format_price(".5"), "$0.50");
        assert_eq!(format_price(""), "$0");
        assert_eq!(format_price("1.234"), "$1.23");
        assert_eq!(price_cents("abc"), None);
        assert_eq!(format_price("abc"), "$NaN.NaN");
    }

    #[test]
    fn orders_prices_by_cents() {
        let mut prices = vec!["120.00", "45.5", "1200", "45.05", "9"];
        prices.sort_by_key(|p| price_cents(p));
        assert_eq!(prices, ["9", "45.05", "45.5", "120.00", "1200"]);
    }
}

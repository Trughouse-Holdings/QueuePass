// Copied from admin-rust-app/core/src/money.rs at 680b4f7 (spec 040 R4).
//! Spec 037: money as the React Admin app shows and checks it, built from the decimal strings'
//! digits and integer cents, never through a floating-point number (Constitution, Money).
//!
//! Ports `admin-app/src/money.ts`, `BASE_PRICE_PATTERN` of `packages/shared/src/event.ts`, and
//! `priceCents` and `formatPrice` of `packages/shared/src/web/venue-map/map-state.ts`. The
//! TypeScript's results on odd input are kept ("$-5.-50", "$NaN.NaN"); the Backend only sends
//! amounts that match [`BASE_PRICE_PATTERN`].

use std::sync::LazyLock;

use regress::Regex;

/// Ports `BASE_PRICE_PATTERN` (`event.ts`): a decimal string with at most two fractional digits,
/// non-negative. A JavaScript pattern, run with `regress` so it means what it means there.
pub const BASE_PRICE_PATTERN: &str = r"^\d+(\.\d{1,2})?$";

static BASE_PRICE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(BASE_PRICE_PATTERN).expect("a valid pattern"));

/// `BASE_PRICE_PATTERN.test(price)` (`event.ts`).
pub fn is_base_price(price: &str) -> bool {
    BASE_PRICE.find(price).is_some()
}

/// `usd`'s thousands pattern, `/\B(?=(\d{3})+(?!\d))/g`.
static THOUSANDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\B(?=(\d{3})+(?!\d))").expect("a valid pattern"));

/// `amount.split('.')` destructured as `[whole, fraction = '']`.
fn split_amount(amount: &str) -> (&str, &str) {
    let mut parts = amount.split('.');
    (parts.next().unwrap_or(""), parts.next().unwrap_or(""))
}

/// `fraction.padEnd(2, '0').slice(0, 2)`.
fn two_fraction_digits(fraction: &str) -> String {
    fraction
        .chars()
        .chain(std::iter::repeat('0'))
        .take(2)
        .collect()
}

/// Ports `usd` (`money.ts`): a decimal-string amount as US dollars with thousands separators,
/// "$4,321.50", built from the string's digits.
pub fn usd(amount: &str) -> String {
    let (whole, fraction) = split_amount(amount);
    let mut grouped = String::with_capacity(whole.len() + whole.len() / 3);
    let mut last = 0;
    for m in THOUSANDS.find_iter(whole) {
        let at = m.range().start;
        grouped.push_str(&whole[last..at]);
        grouped.push(',');
        last = at;
    }
    grouped.push_str(&whole[last..]);
    format!("${grouped}.{}", two_fraction_digits(fraction))
}

/// JavaScript's `Number(text)` where the result is a whole number of optional sign and ASCII
/// digits (an empty or blank string is 0); `None` stands for `NaN`, and for the forms these
/// strings never take (`1e3`, `0x10`, `Infinity`, past `i64`).
fn js_integer(text: &str) -> Option<i64> {
    let t = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if t.is_empty() {
        return Some(0);
    }
    let (negative, digits) = match t.as_bytes()[0] {
        b'-' => (true, &t[1..]),
        b'+' => (false, &t[1..]),
        _ => (false, t),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: i64 = digits.parse().ok()?;
    Some(if negative { -n } else { n })
}

/// Ports `priceCents` (`map-state.ts`): a decimal-string price in whole cents, from its digits
/// (`"60.50"` is 6050; digits past the second are cut). `None` where the TypeScript gives `NaN`.
pub fn price_cents(price: &str) -> Option<i64> {
    let (whole, fraction) = split_amount(price);
    let dollars = js_integer(whole)?;
    let cents = js_integer(&two_fraction_digits(fraction))?;
    dollars.checked_mul(100)?.checked_add(cents)
}

/// `n.toLocaleString('en-US')` for a whole number: "1,200", "-5".
fn grouped_integer(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Ports `formatPrice` (`map-state.ts`): a seat-map price, whole dollars without cents ("$95",
/// "$60.50", "$1,200").
pub fn format_price(price: &str) -> String {
    let Some(c) = price_cents(price) else {
        return "$NaN.NaN".into();
    };
    let dollars = grouped_integer(c.div_euclid(100));
    let rest = c % 100;
    if rest == 0 {
        format!("${dollars}")
    } else {
        format!("${dollars}.{rest:0>2}")
    }
}

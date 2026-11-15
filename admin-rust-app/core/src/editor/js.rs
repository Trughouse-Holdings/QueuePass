//! Spec 037 research R14: the JavaScript string and number behavior the layout editor's rules
//! lean on, so the Rust editor measures, trims, splits, and parses exactly as the React one:
//! `String.prototype.trim`, `.length` and `.slice` in UTF-16 units, `Number(s)`, the `\s` of a
//! regular expression, and `toLocaleString()` (en-US) of a count.

use serde_json::Value;

/// JavaScript's white space and line terminators (`\s`, and what `trim` and `Number` skip).
pub(crate) fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `s.trim()`.
pub(crate) fn trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `s.length`: UTF-16 code units.
pub(crate) fn len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `s.slice(0, n)` for `n >= 0`, in UTF-16 code units (a split pair becomes U+FFFD).
pub(crate) fn slice_to(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

/// `s.charAt(0).toLowerCase() + s.slice(1)`.
pub(crate) fn lower_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// `Number(s)`: white space trimmed; empty is 0; `Infinity` with a sign; `0x`, `0o`, `0b`
/// integers without one; else a decimal literal (`1`, `-1.5`, `.5`, `1.`, `1e3`), or `NaN`.
pub(crate) fn to_number(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let radix = match t.get(..2) {
        Some("0x" | "0X") => Some(16),
        Some("0o" | "0O") => Some(8),
        Some("0b" | "0B") => Some(2),
        _ => None,
    };
    if let Some(radix) = radix {
        let digits = &t[2..];
        if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
            return f64::NAN;
        }
        return digits.chars().fold(0.0, |n, c| {
            n * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
        });
    }
    if is_decimal_literal(t) {
        t.parse().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `StrDecimalLiteral` without `Infinity`: `[+-] (digits [. digits?] | . digits) [e [+-] digits]`.
fn is_decimal_literal(t: &str) -> bool {
    let b = t.as_bytes();
    let mut i = usize::from(matches!(b.first(), Some(b'+' | b'-')));
    let digits = |i: &mut usize| {
        let start = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        *i - start
    };
    let whole = digits(&mut i);
    let mut fraction = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        fraction = digits(&mut i);
    }
    if whole == 0 && fraction == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return false;
        }
    }
    i == b.len()
}

/// `n.toLocaleString()` (en-US) of a whole number: "30,000", "-5".
pub(crate) fn grouped(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

/// A number as `JSON.stringify` writes it: whole numbers without a fraction (`20`, not `20.0`),
/// `NaN` and the infinities as `null`.
pub(crate) fn json_number(n: f64) -> Value {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 9.0e15 {
        // Exact: a whole number this small is an integer in an f64.
        #[allow(clippy::cast_possible_truncation, reason = "whole and under 2^53")]
        Value::from(n as i64)
    } else {
        serde_json::Number::from_f64(n).map_or(Value::Null, Value::Number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_parses_as_javascript() {
        for (s, n) in [
            ("", 0.0),
            ("  ", 0.0),
            (" 12 ", 12.0),
            ("1e1", 10.0),
            (".5e1", 5.0),
            ("+3", 3.0),
            ("-0.5", -0.5),
            ("1.", 1.0),
            ("0x10", 16.0),
            ("0b11", 3.0),
            ("0o7", 7.0),
            ("-Infinity", f64::NEG_INFINITY),
        ] {
            assert_eq!(to_number(s), n, "{s:?}");
        }
        for s in [
            "x", "1_0", "1e", ".", "-", "inf", "NaN", "0x", "-0x10", "1 2", "e5", "+.e1",
        ] {
            assert!(to_number(s).is_nan(), "{s:?}");
        }
    }

    #[test]
    fn strings_measure_and_cut_in_utf16_units() {
        assert_eq!(len("é😀"), 3);
        assert_eq!(slice_to("ab😀c", 3), "ab\u{fffd}");
        assert_eq!(slice_to("abc", 10), "abc");
        assert_eq!(trim("\u{feff} a \u{3000}"), "a");
        assert_eq!(lower_first("Section 101"), "section 101");
        assert_eq!(lower_first(""), "");
    }

    #[test]
    fn counts_group_by_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(30_000), "30,000");
        assert_eq!(grouped(1_234_567), "1,234,567");
        assert_eq!(grouped(-4_000), "-4,000");
    }

    #[test]
    fn json_numbers_are_written_as_javascript_writes_them() {
        assert_eq!(json_number(20.0).to_string(), "20");
        assert_eq!(json_number(-0.0).to_string(), "0");
        assert_eq!(json_number(100.5).to_string(), "100.5");
        assert_eq!(json_number(f64::NAN), Value::Null);
        assert_eq!(json_number(1e300).as_f64(), Some(1e300));
        assert!(json_number(1e300).is_f64());
    }
}

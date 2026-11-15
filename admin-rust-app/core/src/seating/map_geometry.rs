//! Spec 037 research R13 (T032): the shared venue map's geometry, ported from
//! `packages/shared/src/web/venue-map/map-geometry.ts`. Places are the layout's map units, `y`
//! growing downward as in SVG, so an outline is drawn as it is, with no transform.
//!
//! Also the JavaScript arithmetic the seat-map ports share, so their numbers and strings come out
//! exactly as the React app's: `String(n)` ([`js_number`]), `Math.round` ([`js_round`]),
//! `Math.hypot` ([`js_hypot`]), `Math.min`/`Math.max` over a list ([`js_min`], [`js_max`]), and
//! `Math.sin`, `Math.cos`, `Math.exp`, and `**` ([`js_sin`], [`js_cos`], [`js_exp`],
//! [`js_pow`]). V8 computes the last four with fdlibm: here `exp` is V8's own, and the others the
//! `libm` crate's fdlibm, the same natively and in WebAssembly. (Where V8 is compiled with fused
//! multiply-adds, as Node is on Apple silicon, its results can differ from fdlibm's in the last
//! bit; see `fused_last_bits` in `tests/seating_geometry.rs`.)

use serde::{Deserialize, Serialize};

/// `Point` of `map-geometry.ts`: `[x, y]` in map units.
pub type Point = [f64; 2];

/// `Bounds` of `map-geometry.ts`: a rectangle of map units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// `sectionViewBox`'s default margin, in map units.
pub const SECTION_VIEW_BOX_MARGIN: f64 = 4.0;

/// `outlinePath`: an outline as a closed SVG path, `M x y L x y … Z`, its numbers as JavaScript
/// writes them.
pub fn outline_path(points: &[Point]) -> String {
    let mut d = String::new();
    for (i, [x, y]) in points.iter().enumerate() {
        d.push(if i == 0 { 'M' } else { 'L' });
        d.push_str(&js_number(*x));
        d.push(' ');
        d.push_str(&js_number(*y));
    }
    d.push('Z');
    d
}

/// `bounds`: the smallest rectangle around the points. As in JavaScript, no points give `x` and
/// `y` of infinity and a width and height of minus infinity.
pub fn bounds(points: &[Point]) -> Bounds {
    let x = js_min(points.iter().map(|p| p[0]));
    let y = js_min(points.iter().map(|p| p[1]));
    Bounds {
        x,
        y,
        width: js_max(points.iter().map(|p| p[0])) - x,
        height: js_max(points.iter().map(|p| p[1])) - y,
    }
}

/// `centroid`: a polygon's centroid, the center of its area (where a section's name goes when its
/// layout file gives none, 038 research R5); the average of its points when it has no area.
pub fn centroid(points: &[Point]) -> Point {
    let (mut area, mut cx, mut cy) = (0.0, 0.0, 0.0);
    for (i, [x0, y0]) in points.iter().copied().enumerate() {
        let [x1, y1] = points[(i + 1) % points.len()];
        let cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    if area.abs() < 1e-9 {
        let n = points.len() as f64;
        return [
            points.iter().fold(0.0, |s, p| s + p[0]) / n,
            points.iter().fold(0.0, |s, p| s + p[1]) / n,
        ];
    }
    [cx / (3.0 * area), cy / (3.0 * area)]
}

/// `sectionViewBox`: a section's `viewBox`, its bounds with `margin` map units on every side
/// ([`SECTION_VIEW_BOX_MARGIN`] in the TypeScript's default).
pub fn section_view_box(outline: &[Point], margin: f64) -> String {
    let b = bounds(outline);
    format!(
        "{} {} {} {}",
        js_number(b.x - margin),
        js_number(b.y - margin),
        js_number(b.width + 2.0 * margin),
        js_number(b.height + 2.0 * margin)
    )
}

// ------------------------------------------------------------------------------ JavaScript numbers

/// JavaScript's `String(n)` (Number::toString): the shortest digits that read back as `n`, plain
/// from 1e-6 up to below 1e21 (`0.000001`, `100000000000000000000`), else with an exponent
/// (`1e-7`, `1.5e+21`); `-0` is `0`, and `NaN`, `Infinity`, `-Infinity` by name.
pub fn js_number(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let (digits, exponent) = shortest_digits(n.abs());
    let k = digits.len() as i32;
    // The value is 0.d₁d₂…dₖ × 10ⁿ.
    let n_ = exponent + 1;
    let body = if k <= n_ && n_ <= 21 {
        format!("{digits}{}", "0".repeat((n_ - k) as usize))
    } else if 0 < n_ && n_ <= 21 {
        format!("{}.{}", &digits[..n_ as usize], &digits[n_ as usize..])
    } else if -6 < n_ && n_ <= 0 {
        format!("0.{}{digits}", "0".repeat((-n_) as usize))
    } else {
        let sign = if n_ > 0 { '+' } else { '-' };
        let power = (n_ - 1).abs();
        if k == 1 {
            format!("{digits}e{sign}{power}")
        } else {
            format!("{}.{}e{sign}{power}", &digits[..1], &digits[1..])
        }
    };
    if n < 0.0 { format!("-{body}") } else { body }
}

/// The fewest significant digits that read back as `x` (positive, finite), and the power of ten
/// of the first: `d₁.d₂…dₖ × 10^exponent`. Rust's `{:e}` gives them, except when `x` lies exactly
/// halfway between two such candidates: JavaScript then takes the even one (Number::toString,
/// step 5) where Rust rounds up, so `622087415307760.25` is `622087415307760.2`.
fn shortest_digits(x: f64) -> (String, i32) {
    let e = format!("{x:e}");
    let (mantissa, exponent) = e.split_once('e').expect("an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().expect("an exponent");
    let k = digits.len();
    let odd = digits.as_bytes()[k - 1] % 2 == 1;
    if !odd {
        return (digits, exponent);
    }
    // A tie shows as a 5 in the next place, then nothing: check it on the exact value (every
    // double's decimal expansion ends within 767 significant digits).
    let next = format!("{x:.k$e}");
    if !next.split_once('e').expect("an exponent").0.ends_with('5') {
        return (digits, exponent);
    }
    let exact = format!("{x:.1100e}");
    let (exact_mantissa, exact_exponent) = exact.split_once('e').expect("an exponent");
    let exact_digits: Vec<u8> = exact_mantissa.bytes().filter(|b| *b != b'.').collect();
    let tie = exact_exponent.parse::<i32>() == Ok(exponent)
        && exact_digits[k] == b'5'
        && exact_digits[k + 1..].iter().all(|b| *b == b'0');
    if !tie {
        return (digits, exponent);
    }
    // The other candidate is one less or one more in the last place, without a carry.
    let truncated = &exact_digits[..k];
    let other: Vec<u8> = if truncated == digits.as_bytes() {
        let mut up = truncated.to_vec();
        if up[k - 1] == b'9' {
            return (digits, exponent);
        }
        up[k - 1] += 1;
        up
    } else {
        truncated.to_vec()
    };
    let other = String::from_utf8(other).expect("digits");
    let back = format!("{other}e{}", exponent - (k as i32 - 1));
    if back.parse::<f64>() == Ok(x) {
        (other, exponent)
    } else {
        (digits, exponent)
    }
}

/// JavaScript's `Math.round`: the nearest integer, halves up (`-2.5` → `-2`), keeping `-0`
/// (`-0.4` → `-0`).
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x < 0.0 { -0.0 } else { r }
}

/// JavaScript's `Math.hypot(a, b)`, as V8 computes it: scaled by the larger, summed with Kahan
/// compensation (not the C library's `hypot`, which can differ in the last bit).
pub fn js_hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    if a == f64::INFINITY || b == f64::INFINITY {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let max = if a > b { a } else { b };
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0_f64, 0.0_f64);
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// JavaScript's `Math.min(...values)`: `NaN` if any is, `-0` below `0`, infinity for none.
pub fn js_min(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(f64::INFINITY, |m, v| {
        if m.is_nan() || v.is_nan() {
            f64::NAN
        } else if v < m || (v == 0.0 && m == 0.0 && v.is_sign_negative()) {
            v
        } else {
            m
        }
    })
}

/// JavaScript's `Math.max(...values)`: `NaN` if any is, `0` above `-0`, minus infinity for none.
pub fn js_max(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(f64::NEG_INFINITY, |m, v| {
        if m.is_nan() || v.is_nan() {
            f64::NAN
        } else if v > m || (v == 0.0 && m == 0.0 && v.is_sign_positive()) {
            v
        } else {
            m
        }
    })
}

/// JavaScript's `Math.sin` (fdlibm, as V8).
pub fn js_sin(x: f64) -> f64 {
    libm::sin(x)
}

/// JavaScript's `Math.cos` (fdlibm, as V8).
pub fn js_cos(x: f64) -> f64 {
    libm::cos(x)
}

/// JavaScript's `Math.exp`: V8's `ieee754::exp`, FreeBSD's fdlibm `e_exp.c` with V8's one change,
/// `exp(1)` is exactly `Math.E`. (The `libm` crate's `exp` is musl's rewrite of it, which rounds
/// differently now and then.)
#[allow(
    clippy::excessive_precision,
    clippy::approx_constant,
    reason = "fdlibm's constants, digit for digit"
)]
pub fn js_exp(x: f64) -> f64 {
    const HALF: [f64; 2] = [0.5, -0.5];
    const O_THRESHOLD: f64 = 7.09782712893383973096e+02;
    const U_THRESHOLD: f64 = -7.45133219101941108420e+02;
    const LN2_HI: [f64; 2] = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
    const LN2_LO: [f64; 2] = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
    const INV_LN2: f64 = 1.44269504088896338700e+00;
    const P1: f64 = 1.66666666666666019037e-01;
    const P2: f64 = -2.77777777770155933842e-03;
    const P3: f64 = 6.61375632143793436117e-05;
    const P4: f64 = -1.65339022054652515390e-06;
    const P5: f64 = 4.13813679705723846039e-08;
    const HUGE: f64 = 1.0e+300;
    const TWO_M1000: f64 = 9.33263618503218878990e-302;
    const TWO_1023: f64 = 8.988465674311579539e307;

    let bits = x.to_bits();
    let xsb = (bits >> 63) as usize;
    let hx = ((bits >> 32) as u32) & 0x7fff_ffff;
    // Not finite, or far out.
    if hx >= 0x4086_2e42 {
        if hx >= 0x7ff0_0000 {
            if x.is_nan() {
                return x + x;
            }
            return if xsb == 0 { x } else { 0.0 };
        }
        if x > O_THRESHOLD {
            return HUGE * HUGE;
        }
        if x < U_THRESHOLD {
            return TWO_M1000 * TWO_M1000;
        }
    }
    // Argument reduction.
    let (mut x, mut hi, mut lo, mut k) = (x, 0.0, 0.0, 0_i32);
    if hx > 0x3fd6_2e42 {
        if hx < 0x3ff0_a2b2 {
            if x == 1.0 {
                return std::f64::consts::E;
            }
            hi = x - LN2_HI[xsb];
            lo = LN2_LO[xsb];
            k = 1 - 2 * xsb as i32;
        } else {
            k = (INV_LN2 * x + HALF[xsb]) as i32;
            let t = f64::from(k);
            hi = x - t * LN2_HI[0];
            lo = t * LN2_LO[0];
        }
        x = hi - lo;
    } else if hx < 0x3e30_0000 {
        return 1.0 + x;
    }
    // x is now in the primary range.
    let t = x * x;
    let twopk = if k >= -1021 {
        f64::from_bits(((0x3ff + i64::from(k)) as u64) << 52)
    } else {
        f64::from_bits(((0x3ff + i64::from(k) + 1000) as u64) << 52)
    };
    let c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if k == 0 {
        return 1.0 - ((x * c) / (c - 2.0) - x);
    }
    let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        if k == 1024 {
            return y * 2.0 * TWO_1023;
        }
        y * twopk
    } else {
        y * twopk * TWO_M1000
    }
}

/// JavaScript's `x ** y` and `Math.pow` (fdlibm, as V8), with JavaScript's own answers where C's
/// differ: `NaN` for a `NaN` exponent (C gives `1 ** NaN = 1`) and for `±1 ** ±Infinity`.
pub fn js_pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || (x.abs() == 1.0 && y.is_infinite()) {
        return f64::NAN;
    }
    libm::pow(x, y)
}

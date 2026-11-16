//! Spec 040 T056 (parity T12; research R9; spec 017 FR-012, 018 R8): a ticket's QR code, the same
//! modules `qrcode-generator` 2.0.4 draws in `customer-app/src/components/TicketQr.tsx`
//! (`qrcode(0, 'M')`, one alphanumeric segment): the smallest version whose data fits at level M
//! (the terminator not counted, as `make()` checks), the standard data and error-correction
//! codewords and placement (the `qrcode` crate's `Bits`, `ec`, and `Canvas`, without its segment
//! optimiser), and the mask `getBestMaskPattern` picks: the lowest `getLostPoint`, the first on a
//! tie, scored with the format and version information all light (its `makeImpl(true, …)`).
//! Fixtures from `qrcode-generator` itself (`tests/fixtures/customer/qr.json`) are the reference.

use qrcode::bits::Bits;
use qrcode::canvas::{Canvas, MaskPattern};
use qrcode::ec::construct_codewords;
use qrcode::types::{EcLevel, Version};

/// The 4-module quiet zone around the code.
pub const QUIET_ZONE: usize = 4;

/// QR's alphanumeric set.
const ALPHANUMERIC: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/// The masks in `qrcode-generator`'s order, 0 to 7.
const MASKS: [MaskPattern; 8] = [
    MaskPattern::Checkerboard,
    MaskPattern::HorizontalLines,
    MaskPattern::VerticalLines,
    MaskPattern::DiagonalLines,
    MaskPattern::LargeCheckerboard,
    MaskPattern::Fields,
    MaskPattern::Diamonds,
    MaskPattern::Meadow,
];

/// The data bits of `text` at version `v`, or `None` when it does not fit at level M.
fn data_bits(text: &str, v: i16) -> Option<Bits> {
    let mut bits = Bits::new(Version::Normal(v));
    bits.push_alphanumeric_data(text.as_bytes()).ok()?;
    (bits.len() <= bits.max_len(EcLevel::M).ok()?).then_some(bits)
}

/// The canvas before masking (functional patterns and the codewords), and its version.
fn unmasked(text: &str) -> Option<(Canvas, usize)> {
    let (v, mut bits) = (1..=40).find_map(|v| data_bits(text, v).map(|b| (v, b)))?;
    bits.push_terminator(EcLevel::M).ok()?;
    let version = Version::Normal(v);
    let (data, ec) = construct_codewords(&bits.into_bytes(), version, EcLevel::M).ok()?;
    let mut canvas = Canvas::new(version, EcLevel::M);
    canvas.draw_all_functional_patterns();
    canvas.draw_data(&data, &ec);
    Some((canvas, v as usize))
}

/// The canvas as rows of dark (`true`) modules.
fn grid_of(canvas: &Canvas, n: usize) -> Vec<Vec<bool>> {
    (0..n)
        .map(|r| {
            (0..n)
                .map(|c| canvas.get(c as i16, r as i16).is_dark())
                .collect()
        })
        .collect()
}

/// `setupTypeInfo(true, …)` and `setupTypeNumber(true)`: the format information, the fixed dark
/// module, and (version 7 and up) the version information, all light, as the mask is scored.
fn blank_info(grid: &mut [Vec<bool>], version: usize) {
    let n = grid.len();
    for i in 0..15 {
        let row = if i < 6 {
            i
        } else if i < 8 {
            i + 1
        } else {
            n - 15 + i
        };
        grid[row][8] = false;
        let col = if i < 8 {
            n - i - 1
        } else if i < 9 {
            15 - i
        } else {
            15 - i - 1
        };
        grid[8][col] = false;
    }
    grid[n - 8][8] = false;
    if version >= 7 {
        for i in 0..18 {
            grid[i / 3][i % 3 + n - 11] = false;
            grid[i % 3 + n - 11][i / 3] = false;
        }
    }
}

/// Ports `QRUtil.getLostPoint`, the penalty `qrcode-generator` scores a mask by.
pub fn lost_point(m: &[Vec<bool>]) -> f64 {
    let n = m.len();
    let dark = |r: usize, c: usize| m[r][c];
    let mut lost = 0i64;
    // Level 1: modules with more than 5 like neighbours.
    for row in 0..n {
        for col in 0..n {
            let mut same = 0;
            for r in -1i64..=1 {
                let rr = row as i64 + r;
                if rr < 0 || rr >= n as i64 {
                    continue;
                }
                for c in -1i64..=1 {
                    let cc = col as i64 + c;
                    if cc < 0 || cc >= n as i64 || (r == 0 && c == 0) {
                        continue;
                    }
                    if dark(row, col) == dark(rr as usize, cc as usize) {
                        same += 1;
                    }
                }
            }
            if same > 5 {
                lost += 3 + same - 5;
            }
        }
    }
    // Level 2: 2 × 2 blocks of one colour.
    for row in 0..n - 1 {
        for col in 0..n - 1 {
            let count = [
                dark(row, col),
                dark(row + 1, col),
                dark(row, col + 1),
                dark(row + 1, col + 1),
            ]
            .iter()
            .filter(|d| **d)
            .count();
            if count == 0 || count == 4 {
                lost += 3;
            }
        }
    }
    // Level 3: the 1:1:3:1:1 finder-like runs, across and down.
    const RUN: [bool; 7] = [true, false, true, true, true, false, true];
    for row in 0..n {
        for col in 0..n - 6 {
            if (0..7).all(|k| dark(row, col + k) == RUN[k]) {
                lost += 40;
            }
        }
    }
    for col in 0..n {
        for row in 0..n - 6 {
            if (0..7).all(|k| dark(row + k, col) == RUN[k]) {
                lost += 40;
            }
        }
    }
    // Level 4: the dark share's distance from half (floating point, as in JavaScript).
    let dark_count = m.iter().flatten().filter(|d| **d).count() as f64;
    let nf = n as f64;
    let ratio = (100.0 * dark_count / nf / nf - 50.0).abs() / 5.0;
    lost as f64 + ratio * 10.0
}

/// Ports `qrMatrix` (`TicketQr.tsx`): `text`'s modules, row by row, dark `true`; `None` for text
/// outside QR's alphanumeric set (upper case, digits, space, `$%*+-./:`) or too long.
pub fn qr_matrix(text: &str) -> Option<Vec<Vec<bool>>> {
    if !text.bytes().all(|b| ALPHANUMERIC.contains(&b)) {
        return None;
    }
    let (base, version) = unmasked(text)?;
    let size = version * 4 + 17;
    let mut best: Option<(f64, MaskPattern)> = None;
    for mask in MASKS {
        let mut c = base.clone();
        c.apply_mask(mask);
        let mut g = grid_of(&c, size);
        blank_info(&mut g, version);
        let lost = lost_point(&g);
        if best.is_none_or(|(min, _)| min > lost) {
            best = Some((lost, mask));
        }
    }
    let (_, mask) = best?;
    let mut c = base;
    c.apply_mask(mask);
    Some(grid_of(&c, size))
}

/// Ports `pathOf`: the dark modules as one SVG path, `M{c+4} {r+4}h1v1h-1z` each.
pub fn qr_path(matrix: &[Vec<bool>]) -> String {
    let mut out = String::new();
    for (r, row) in matrix.iter().enumerate() {
        for (c, dark) in row.iter().enumerate() {
            if *dark {
                out.push_str(&format!("M{} {}h1v1h-1z", c + QUIET_ZONE, r + QUIET_ZONE));
            }
        }
    }
    out
}

/// The SVG's side, the modules plus the quiet zone on both sides.
pub fn qr_size(matrix: &[Vec<bool>]) -> usize {
    matrix.len() + 2 * QUIET_ZONE
}

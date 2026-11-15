//! Spec 037 (research R7, X3), port of `admin-app/src/export/pdf.ts` with `printpdf` 0.12: the
//! same embedded Noto Sans fonts, heading, and table, and a small table layout standing in for
//! `jspdf-autotable` (its column-width rules, line wrapping within a column, `nowrap` columns,
//! the header repeated on every page, rows never split across pages), then "Page n of m".

use std::collections::BTreeSet;
use std::sync::OnceLock;

use printpdf::{
    Color, Line, LinePoint, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions,
    Point, Pt, Rect, Rgb, TextItem,
};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use super::rows::{group_digits, usd};
use super::table::{Cell, CellKind, ExportError, ExportTable};

pub const PDF_TYPE: &str = "application/pdf";

/// FR-009: said in the heading when any character had to be shown as `?`.
pub const REPLACED_NOTE: &str =
    "Some characters are shown as ?; the CSV and Excel files have the exact text.";

// The React app's committed font files, not copies (`admin-app/src/export/fonts`, OFL).
const REGULAR_TTF: &[u8] =
    include_bytes!("../../../../admin-app/src/export/fonts/NotoSans-Regular.ttf");
const BOLD_TTF: &[u8] = include_bytes!("../../../../admin-app/src/export/fonts/NotoSans-Bold.ttf");

/// A face, with its advance widths for the Basic Multilingual Plane in a table, as a large list
/// measures millions of characters.
struct Face {
    font: ParsedFont,
    /// Advance in font units per BMP code point (0 without a glyph).
    bmp: Vec<u16>,
    units_per_em: f32,
}

impl Face {
    fn new(bytes: &[u8], name: &str) -> Self {
        let mut font = ParsedFont::from_bytes(bytes, 0, &mut Vec::new())
            .unwrap_or_else(|| panic!("the embedded {name} parses"));
        // The PDF's /BaseFont, as jsPDF names it.
        font.font_name = Some(name.into());
        let mut bmp = vec![0u16; 0x1_0000];
        for (&cp, &gid) in &font.codepoint_to_glyph {
            if let (Some(slot), Some(w)) = (bmp.get_mut(cp as usize), font.get_glyph_width(gid)) {
                *slot = w;
            }
        }
        Self {
            units_per_em: f32::from(font.units_per_em),
            font,
            bmp,
        }
    }

    fn advance(&self, c: char) -> u32 {
        match self.bmp.get(c as usize) {
            Some(&w) => u32::from(w),
            None => self
                .font
                .lookup_glyph_index(c as u32)
                .and_then(|g| self.font.get_glyph_width(g))
                .map_or(0, u32::from),
        }
    }
}

struct Fonts {
    regular: Face,
    bold: Face,
    glyphs: BTreeSet<u32>,
    /// Every printable ASCII character has a glyph: such text needs no checking.
    ascii: bool,
}

/// Parsed once: both faces and the regular face's characters.
fn fonts() -> &'static Fonts {
    static FONTS: OnceLock<Fonts> = OnceLock::new();
    FONTS.get_or_init(|| {
        let regular = Face::new(REGULAR_TTF, "NotoSans-Regular");
        let bold = Face::new(BOLD_TTF, "NotoSans-Bold");
        let glyphs: BTreeSet<u32> = regular
            .font
            .codepoint_to_glyph
            .iter()
            .filter(|&(_, gid)| *gid != 0)
            .map(|(cp, _)| *cp)
            .collect();
        Fonts {
            ascii: (0x20..0x7f).all(|c| glyphs.contains(&c)),
            regular,
            bold,
            glyphs,
        }
    })
}

// ------------------------------------------------------------------ the font's characters

/// Research R10 of spec 023: every code point Noto Sans Regular has a glyph for (its `cmap`).
pub fn font_glyphs() -> &'static BTreeSet<u32> {
    &fonts().glyphs
}

/// FR-009 (research R10): the text as the PDF can show it, and whether anything was replaced.
/// Composed first (a decomposed "ë" is one character in the font); any character the font
/// lacks becomes `?`. Line breaks stay.
pub fn pdf_text(s: &str) -> (String, bool) {
    let f = fonts();
    if f.ascii && s.bytes().all(|b| (0x20..0x7f).contains(&b) || b == b'\n') {
        return (s.to_string(), false);
    }
    let glyphs = &f.glyphs;
    let mut replaced = false;
    let text = s
        .nfc()
        .map(|c| {
            if c == '\n' || glyphs.contains(&(c as u32)) {
                c
            } else {
                replaced = true;
                '?'
            }
        })
        .collect();
    (text, replaced)
}

// ------------------------------------------------------------------ the layout (pure)

/// Every string the PDF draws, decided without drawing (the React tests' model).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfLayout {
    pub heading: Vec<String>,
    pub head: Vec<String>,
    pub body: Vec<Vec<String>>,
    /// Per column: sized to its content and never wrapped (codes, dates, numbers).
    pub nowrap: Vec<bool>,
}

/// As the page shows it: `2026-10-01 19:00`, `$1,045.00`, `1,200`.
fn shown(cell: &Cell) -> String {
    match cell {
        Cell::Text(v) => v.clone(),
        Cell::DateTime(v) => v.replacen('T', " ", 1),
        Cell::Money(v) => usd(v),
        Cell::Count(n) => group_digits(*n),
    }
}

/// Research R10: the heading, head, and body strings, with `REPLACED_NOTE` when needed.
pub fn pdf_layout(table: &ExportTable) -> PdfLayout {
    let mut replaced = false;
    let mut fit = |s: &str| {
        let (text, r) = pdf_text(s);
        replaced |= r;
        text
    };
    let mut heading: Vec<String> = std::iter::once(&table.title)
        .chain(&table.subtitle)
        .map(|s| fit(s))
        .collect();
    let head = table.columns.iter().map(|c| fit(&c.header)).collect();
    let body = table
        .rows
        .iter()
        .map(|row| row.iter().map(|c| fit(&shown(c))).collect())
        .collect();
    if replaced {
        heading.push(REPLACED_NOTE.into());
    }
    PdfLayout {
        heading,
        head,
        body,
        nowrap: table
            .columns
            .iter()
            .map(|c| c.nowrap.unwrap_or(c.kind != CellKind::Text))
            .collect(),
    }
}

// ------------------------------------------------------------------ measuring and wrapping

const PAGE_W: f32 = 792.0; // letter landscape
const PAGE_H: f32 = 612.0;
const MARGIN: f32 = 36.0; // half an inch
const FOOTER: f32 = 18.0; // room for "Page n of m" under the table
const WIDTH: f32 = PAGE_W - 2.0 * MARGIN;
/// A text column never gets narrower than this many points per character of its Excel width,
/// so one very long word elsewhere cannot squeeze short words into pieces (023 review round 1).
const MIN_PT_PER_CHAR: f32 = 3.0;
const BODY_PT: f32 = 9.0; // FR-009: never below 9 points
const PADDING: f32 = 3.0;
/// jsPDF's line height factor, and where the first baseline sits in a line (`autoTableText`).
const LINE_HEIGHT: f32 = 1.15;
const FIRST_BASELINE: f32 = 2.0 - LINE_HEIGHT;
/// autotable's default minimum width of an `auto` cell, in points.
const DEFAULT_MIN_CELL: f32 = 10.0;

const ACCENT: [u8; 3] = [79, 70, 229]; // the React file's indigo: the file must match (X3)
const INK: [u8; 3] = [17, 24, 39];
const RULE: [u8; 3] = [209, 213, 219];

/// The advance width of a string, in points: the glyphs' advances, no kerning (as jsPDF).
fn width_of(face: &Face, s: &str, size: f32) -> f32 {
    let units: u32 = s.chars().map(|c| face.advance(c)).sum();
    units as f32 * size / face.units_per_em
}

fn char_widths(face: &Face, s: &str, size: f32) -> Vec<(char, f32)> {
    let scale = size / face.units_per_em;
    s.chars()
        .map(|c| (c, face.advance(c) as f32 * scale))
        .collect()
}

/// jsPDF's `splitLongWord`: a word wider than a line, cut into pieces, the first one to fit
/// what is left of the current line.
fn split_long_word(widths: &[(char, f32)], first_max: f32, max: f32) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut i = 0;
    let mut working = 0.0;
    while i < widths.len() && working + widths[i].1 < first_max {
        working += widths[i].1;
        i += 1;
    }
    pieces.push(widths[..i].iter().map(|w| w.0).collect());
    let mut start = i;
    working = 0.0;
    while i < widths.len() {
        if working + widths[i].1 > max {
            pieces.push(widths[start..i].iter().map(|w| w.0).collect());
            working = 0.0;
            start = i;
        }
        working += widths[i].1;
        i += 1;
    }
    if start != i {
        pieces.push(widths[start..i].iter().map(|w| w.0).collect());
    }
    pieces
}

/// jsPDF's `splitTextToSize`: each paragraph wrapped at spaces to `max` points; a word wider
/// than a line is cut.
fn split_text(font: &Face, text: &str, max: f32, size: f32) -> Vec<String> {
    if !text.contains('\n') && width_of(font, text, size) <= max {
        return vec![text.to_string()];
    }
    let space = width_of(font, " ", size);
    let mut out = Vec::new();
    for paragraph in text.split('\n') {
        let mut lines: Vec<Vec<String>> = vec![Vec::new()];
        let (mut length, mut separator) = (0.0, 0.0);
        for word in paragraph.split(' ') {
            let widths = char_widths(font, word, size);
            let mut current: f32 = widths.iter().map(|w| w.1).sum();
            if length + separator + current > max {
                if current > max {
                    let mut pieces = split_long_word(&widths, max - (length + separator), max);
                    let first = pieces.remove(0);
                    lines.last_mut().expect("a line").push(first);
                    let last = pieces.pop().unwrap_or_default();
                    for middle in pieces {
                        lines.push(vec![middle]);
                    }
                    let taken = widths.len() - last.chars().count();
                    current = widths[taken..].iter().map(|w| w.1).sum();
                    lines.push(vec![last]);
                } else {
                    lines.push(vec![word.to_string()]);
                }
                length = current;
            } else {
                lines.last_mut().expect("a line").push(word.to_string());
                length += separator + current;
            }
            separator = space;
        }
        out.extend(lines.into_iter().map(|words| words.join(" ")));
    }
    out
}

// ------------------------------------------------------------------ the table's columns

#[derive(Clone, Copy, Default)]
struct Column {
    width: f64,
    wrapped: f64,
    min: f64,
    min_readable: f64,
}

/// jspdf-autotable's `resizeColumns`: the difference shared out in proportion to each column's
/// content width, none below its minimum, repeated while any is left over and a column can
/// still give. Returns what could not be shared out.
fn resize(columns: &mut [Column], ids: &[usize], change: f64, min: &dyn Fn(&Column) -> f64) -> f64 {
    let mut ids = ids.to_vec();
    let mut change = change;
    // autotable recurses without a bound; a few rounds always settle it.
    for _ in 0..64 {
        let total: f64 = ids.iter().map(|&i| columns[i].wrapped).sum();
        let mut left = change;
        for &i in &ids {
            let c = &mut columns[i];
            let ratio = if total > 0.0 {
                c.wrapped / total
            } else {
                1.0 / ids.len() as f64
            };
            let new = (c.width + change * ratio).max(min(c));
            left -= new - c.width;
            c.width = new;
        }
        change = (left * 1e10).round() / 1e10;
        if change == 0.0 {
            break;
        }
        ids.retain(|&i| change > 0.0 || columns[i].width > min(&columns[i]));
        if ids.is_empty() {
            break;
        }
    }
    change
}

/// jspdf-autotable's width calculation: each column's content width, its minimum (a `nowrap`
/// column its content; a text column its Excel width × 3 pt), and its longest word; then the
/// table stretched or squeezed to the page's width.
fn widths(table: &ExportTable, layout: &PdfLayout) -> Vec<f32> {
    let f = fonts();
    let mut columns = vec![Column::default(); table.columns.len()];
    let width = |font: &Face, s: &str| f64::from(width_of(font, s, BODY_PT));
    let pad = f64::from(2.0 * PADDING);
    let mut measure = |cells: &[String], font: &Face, body: bool| {
        for (i, text) in cells.iter().enumerate().take(columns.len()) {
            let content = text.split('\n').map(|l| width(font, l)).fold(0.0, f64::max) + pad;
            let longest = text
                .split(|c: char| c.is_whitespace() && c != '\u{a0}')
                .map(|w| width(font, w))
                .fold(0.0, f64::max);
            // The head's cells take no column style (autotable applies them to the body).
            let (min, wrapped) = if body && layout.nowrap[i] {
                let w = content.min(f64::from(WIDTH));
                (w, w)
            } else {
                let min = if body {
                    f64::from(table.columns[i].width as f32 * MIN_PT_PER_CHAR)
                } else {
                    f64::from(DEFAULT_MIN_CELL)
                };
                (min, content.max(min))
            };
            let c = &mut columns[i];
            c.wrapped = c.wrapped.max(wrapped);
            c.min = c.min.max(min);
            c.min_readable = c.min_readable.max(longest + pad);
        }
    };
    measure(&layout.head, &f.bold, false);
    for row in &layout.body {
        measure(row, &f.regular, true);
    }
    for c in &mut columns {
        c.width = c.wrapped;
    }
    let ids: Vec<usize> = (0..columns.len()).collect();
    let mut change = f64::from(WIDTH) - columns.iter().map(|c| c.width).sum::<f64>();
    if change != 0.0 {
        change = resize(&mut columns, &ids, change, &|c| c.min_readable.max(c.min));
    }
    if change != 0.0 {
        resize(&mut columns, &ids, change, &|c| c.min);
    }
    columns.iter().map(|c| c.width as f32).collect()
}

/// The PDF table's column widths in points, as drawn (the React `pdf.fit` test's measure).
pub fn column_widths(table: &ExportTable) -> Vec<f32> {
    widths(table, &pdf_layout(table))
}

// ------------------------------------------------------------------ drawing

#[derive(Clone, Copy, PartialEq)]
enum Style {
    Regular,
    Bold,
}

/// One page's operations, with the font and colours in effect so each is set only on change.
struct PageOps {
    ops: Vec<Op>,
    face: Option<(Style, u32)>,
    fill: Option<[u8; 3]>,
}

struct Draw<'a> {
    regular: PdfFontHandle,
    bold: PdfFontHandle,
    fonts: &'a Fonts,
}

/// How a piece of text is drawn.
#[derive(Clone, Copy)]
struct Pen {
    style: Style,
    size: f32,
    color: [u8; 3],
}

/// The table's columns as drawn: widths, and which hold numbers (right-aligned, head too).
struct Columns {
    widths: Vec<f32>,
    right: Vec<bool>,
}

fn rgb(c: [u8; 3]) -> Color {
    Color::Rgb(Rgb {
        r: f32::from(c[0]) / 255.0,
        g: f32::from(c[1]) / 255.0,
        b: f32::from(c[2]) / 255.0,
        icc_profile: None,
    })
}

impl PageOps {
    fn new() -> Self {
        Self {
            ops: Vec::new(),
            face: None,
            fill: None,
        }
    }

    /// One line of text, its baseline `top_down` points below the page's top edge. Each line is
    /// its own text object placed with `Td`, so text extraction reads it as one line.
    fn text(&mut self, d: &Draw, pen: Pen, x: f32, top_down: f32, s: &str) {
        if s.is_empty() {
            return;
        }
        let key = (pen.style, pen.size.to_bits());
        if self.face != Some(key) {
            let font = match pen.style {
                Style::Regular => d.regular.clone(),
                Style::Bold => d.bold.clone(),
            };
            self.ops.push(Op::SetFont {
                font,
                size: Pt(pen.size),
            });
            self.face = Some(key);
        }
        if self.fill != Some(pen.color) {
            self.ops.push(Op::SetFillColor {
                col: rgb(pen.color),
            });
            self.fill = Some(pen.color);
        }
        self.ops.extend([
            Op::StartTextSection,
            Op::SetTextCursor {
                pos: Point {
                    x: Pt(x),
                    y: Pt(PAGE_H - top_down),
                },
            },
            Op::ShowText {
                items: vec![TextItem::Text(s.to_string())],
            },
            Op::EndTextSection,
        ]);
    }

    fn rule(&mut self, x: f32, width: f32, top_down: f32, thickness: f32, color: [u8; 3]) {
        let y = Pt(PAGE_H - top_down);
        let point = |x: f32| LinePoint {
            p: Point { x: Pt(x), y },
            bezier: false,
        };
        self.ops.extend([
            Op::SetOutlineColor { col: rgb(color) },
            Op::SetOutlineThickness { pt: Pt(thickness) },
            Op::DrawLine {
                line: Line {
                    points: vec![point(x), point(x + width)],
                    is_closed: false,
                },
            },
        ]);
    }
}

/// A table row: each cell's lines, and the row's height.
struct Row {
    cells: Vec<Vec<String>>,
    height: f32,
}

fn row(font: &Face, cells: &[String], widths: &[f32]) -> Row {
    let cells: Vec<Vec<String>> = cells
        .iter()
        .zip(widths)
        // autotable adds one point to the text space against rounding.
        .map(|(text, w)| split_text(font, text, w - 2.0 * PADDING + 1.0, BODY_PT))
        .collect();
    let lines = cells.iter().map(Vec::len).max().unwrap_or(1).max(1);
    Row {
        height: lines as f32 * BODY_PT * LINE_HEIGHT + 2.0 * PADDING,
        cells,
    }
}

/// A row's cells, each line at autotable's place: padded, the first baseline 0.85 em down.
fn draw_row(page: &mut PageOps, d: &Draw, r: &Row, pen: Pen, columns: &Columns, top: f32) {
    let font = match pen.style {
        Style::Regular => &d.fonts.regular,
        Style::Bold => &d.fonts.bold,
    };
    let mut x = MARGIN;
    for ((lines, w), right) in r.cells.iter().zip(&columns.widths).zip(&columns.right) {
        for (k, line) in lines.iter().enumerate() {
            let baseline =
                top + PADDING + pen.size * FIRST_BASELINE + k as f32 * pen.size * LINE_HEIGHT;
            let lx = if *right {
                x + w - PADDING - width_of(font, line, pen.size)
            } else {
                x + PADDING
            };
            page.text(d, pen, lx, baseline, line);
        }
        x += w;
    }
}

fn pages(table: &ExportTable, layout: &PdfLayout, d: &Draw) -> Vec<Vec<Op>> {
    let f = d.fonts;
    let mut pages: Vec<PageOps> = vec![PageOps::new()];

    // The heading: the title 16 pt bold, then each line 10 pt, wrapped to the page's width.
    let mut y = MARGIN;
    for (i, line) in layout.heading.iter().enumerate() {
        let (pen, font, advance) = if i == 0 {
            (
                Pen {
                    style: Style::Bold,
                    size: 16.0,
                    color: INK,
                },
                &f.bold,
                20.0,
            )
        } else {
            (
                Pen {
                    style: Style::Regular,
                    size: 10.0,
                    color: INK,
                },
                &f.regular,
                13.0,
            )
        };
        let lines = split_text(font, line, WIDTH, pen.size);
        for (k, l) in lines.iter().enumerate() {
            let baseline = y + k as f32 * advance + pen.size * FIRST_BASELINE;
            pages[0].text(d, pen, MARGIN, baseline, l);
        }
        y += lines.len() as f32 * advance;
    }
    y += 8.0;

    let columns = Columns {
        widths: widths(table, layout),
        // A number column's header sits over its numbers, on the right.
        right: table
            .columns
            .iter()
            .map(|c| matches!(c.kind, CellKind::Money | CellKind::Count))
            .collect(),
    };
    let table_width: f32 = columns.widths.iter().sum();
    let head_pen = Pen {
        style: Style::Bold,
        size: BODY_PT,
        color: ACCENT,
    };
    let body_pen = Pen {
        style: Style::Regular,
        size: BODY_PT,
        color: INK,
    };
    let head = row(&f.bold, &layout.head, &columns.widths);
    let bottom = PAGE_H - MARGIN - FOOTER;
    let draw_head = |page: &mut PageOps, top: f32| {
        draw_row(page, d, &head, head_pen, &columns, top);
        page.rule(MARGIN, table_width, top + head.height, 1.0, ACCENT);
        top + head.height
    };
    y = draw_head(&mut pages[0], y);
    let mut fresh = true;
    for cells in &layout.body {
        let r = row(&f.regular, cells, &columns.widths);
        // Rows are never split across pages; a new page repeats the header.
        if y + r.height > bottom && !fresh {
            pages.push(PageOps::new());
            let page = pages.last_mut().expect("a page");
            y = draw_head(page, MARGIN);
        }
        let page = pages.last_mut().expect("a page");
        draw_row(page, d, &r, body_pen, &columns, y);
        y += r.height;
        page.rule(MARGIN, table_width, y, 0.5, RULE);
        fresh = false;
    }

    let count = pages.len();
    pages
        .into_iter()
        .enumerate()
        .map(|(i, mut page)| {
            let footer = format!("Page {} of {count}", i + 1);
            let x = MARGIN + WIDTH - width_of(&f.regular, &footer, BODY_PT);
            page.text(d, body_pen, x, PAGE_H - MARGIN, &footer);
            page.ops
        })
        .collect()
}

/// Spec 023 FR-009 (research R10): letter landscape, Noto Sans embedded, a heading (report,
/// event, made at, made by), the table with its header on every page and long text wrapped
/// within its column, and "Page n of m" on each page. PDF title and creator "QueuePass".
pub fn to_pdf(table: &ExportTable) -> Result<Vec<u8>, ExportError> {
    let f = fonts();
    let layout = pdf_layout(table);
    let mut doc = PdfDocument::new(layout.heading.first().map_or("", String::as_str));
    doc.metadata.info.creator = "QueuePass".into();
    let draw = Draw {
        regular: PdfFontHandle::External(doc.add_font(&f.regular.font)),
        bold: PdfFontHandle::External(doc.add_font(&f.bold.font)),
        fonts: f,
    };
    let pages = pages(table, &layout, &draw)
        .into_iter()
        .map(|ops| PdfPage {
            media_box: Rect::from_wh(Pt(PAGE_W), Pt(PAGE_H)),
            trim_box: Rect::from_wh(Pt(PAGE_W), Pt(PAGE_H)),
            crop_box: Rect::from_wh(Pt(PAGE_W), Pt(PAGE_H)),
            ops,
        })
        .collect();
    let mut warnings = Vec::new();
    let options = PdfSaveOptions {
        image_optimization: None,
        ..PdfSaveOptions::default()
    };
    let bytes = doc.with_pages(pages).save(&options, &mut warnings);
    if !bytes.starts_with(b"%PDF-") {
        return Err(ExportError::Pdf(format!("{warnings:?}")));
    }
    Ok(bytes)
}

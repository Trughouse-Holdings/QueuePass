//! Spec 037 T067 (research R7, SC-004; parity X1–X3, X5): the three file writers. Ports
//! `admin-app/test/export/{csv,xlsx,xlsx.tz,pdf,pdf.fit,size}.test.*` and the file parts of
//! `attendees-export.test.tsx` and `reports-export.test.tsx`. The CSV must equal the React app's
//! CSV for every fixture byte for byte; the XLSX is read back with `calamine` and the PDF's text
//! with `lopdf`.

use std::collections::BTreeSet;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::time::Instant;

use admin_rust_core::export::csv::{CSV_TYPE, to_csv};
use admin_rust_core::export::made::parse_instant;
use admin_rust_core::export::pdf::{
    PDF_TYPE, REPLACED_NOTE, column_widths, font_glyphs, pdf_layout, pdf_text, to_pdf,
};
use admin_rust_core::export::rows::{
    Event, Order, OrderStatus, SalesReport, SoldSeat, Ticket, TicketStatus, attendee_table,
    sales_table,
};
use admin_rust_core::export::table::{Cell, CellKind, ExportColumn, ExportTable};
use admin_rust_core::export::xlsx::{XLSX_TYPE, to_xlsx};
use calamine::{Data, Reader, Xlsx, open_workbook_from_rs};
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::Deserialize;
use serde_json::Value;

// ------------------------------------------------------------------ fixtures

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/export")
}

fn read(name: &str) -> Vec<u8> {
    let path = fixtures().join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn read_json(name: &str) -> Value {
    serde_json::from_slice(&read(name)).unwrap()
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Input {
    #[serde(rename_all = "camelCase")]
    Attendees {
        event: Event,
        orders: Vec<Order>,
        made_at: DateTime<Utc>,
        made_by: String,
        admin_zone: String,
        kept_checked_in: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    Sales {
        report: SalesReport,
        made_by: String,
        admin_zone: String,
    },
    Table {
        table: ExportTable,
    },
}

fn table(name: &str) -> ExportTable {
    match serde_json::from_value(read_json(&format!("{name}.json"))).unwrap() {
        Input::Attendees {
            event,
            orders,
            made_at,
            made_by,
            admin_zone,
            kept_checked_in,
        } => attendee_table(
            &event,
            &orders,
            made_at,
            &made_by,
            &admin_zone,
            kept_checked_in,
        ),
        Input::Sales {
            report,
            made_by,
            admin_zone,
        } => sales_table(&report, &made_by, &admin_zone),
        Input::Table { table } => table,
    }
}

const ALL: [&str; 6] = [
    "attendees",
    "attendees-removed",
    "attendees-seated",
    "sales",
    "sales-seated",
    "sample",
];

/// The React tests' `SAMPLE`: a small table every writer is tested on.
fn sample() -> ExportTable {
    table("sample")
}

/// The React tests' `sampleOf(n)`: `n` copies of the sample's first row.
fn sample_of(n: usize) -> ExportTable {
    let mut t = sample();
    t.rows = vec![t.rows[0].clone(); n];
    t
}

const MADE: &str = "2026-10-30T14:05:00-04:00";

fn text_of(csv: &[u8]) -> String {
    String::from_utf8(csv.to_vec()).unwrap()
}

// ------------------------------------------------------------------ CSV (X1)

#[test]
fn every_csv_equals_the_react_csv_byte_for_byte() {
    for name in ALL {
        let ours = to_csv(&table(name));
        let theirs = read(&format!("expected/{name}.csv"));
        assert!(
            ours == theirs,
            "{name}:\n{}\n---\n{}",
            text_of(&ours),
            text_of(&theirs)
        );
    }
}

#[test]
fn csv_is_utf8_with_a_byte_order_mark_typed_as_csv() {
    assert_eq!(CSV_TYPE, "text/csv;charset=utf-8");
    assert_eq!(to_csv(&sample())[..3], [0xef, 0xbb, 0xbf]);
}

#[test]
fn csv_writes_exactly_the_header_the_rows_and_exported_at_with_crlf() {
    let expected = [
        "Order placed,Name on tickets,Seat,Ticket code,Checked in,Price,Tickets,Exported at"
            .to_string(),
        format!("2026-09-30 10:00,Jordan Lee,,ABCDEFGH2345,2026-11-01 16:45,84.30,1200,{MADE}"),
        format!(
            "2026-10-01 20:30,\"'=SUM(1,1)\",\"Section A, Row 3, Seat 7\",STUVWXYZ2345,,1045.00,0,{MADE}"
        ),
        format!("2026-10-03 07:00,Zoë “Zo” O’Brien,\"Line one\nline two\",'-12,,0.00,-1,{MADE}"),
    ];
    assert_eq!(
        text_of(&to_csv(&sample())),
        format!("\u{feff}{}\r\n", expected.join("\r\n"))
    );
}

fn one_column(header: &str, kind: CellKind, rows: Vec<Cell>) -> ExportTable {
    ExportTable {
        columns: vec![ExportColumn {
            header: header.into(),
            kind,
            width: 10,
            nowrap: None,
        }],
        rows: rows.into_iter().map(|c| vec![c]).collect(),
        ..sample()
    }
}

#[test]
fn csv_doubles_quotes_and_quotes_fields_with_a_comma_quote_cr_or_lf() {
    let table = one_column(
        "Say \"hi\", all",
        CellKind::Text,
        vec![
            Cell::Text("He said \"no\"".into()),
            Cell::Text("a\rb".into()),
            Cell::Text("plain".into()),
        ],
    );
    let text = text_of(&to_csv(&table));
    let lines: Vec<&str> = text.trim_start_matches('\u{feff}').split("\r\n").collect();
    assert_eq!(
        lines,
        [
            "\"Say \"\"hi\"\", all\",Exported at",
            &format!("\"He said \"\"no\"\"\",{MADE}"),
            &format!("\"a\rb\",{MADE}"),
            &format!("plain,{MADE}"),
            "",
        ]
    );
}

#[test]
fn csv_guards_a_text_cell_starting_like_a_formula_with_an_apostrophe() {
    for first in ['=', '+', '-', '@', '\t', '\r'] {
        let table = one_column(
            "Name",
            CellKind::Text,
            vec![Cell::Text(format!("{first}x"))],
        );
        let text = text_of(&to_csv(&table));
        let field = if first == '\r' {
            "\"'\rx\"".to_string()
        } else {
            format!("'{first}x")
        };
        assert!(
            text.contains(&format!("\r\n{field},{MADE}\r\n")),
            "{first:?}: {text:?}"
        );
    }
}

#[test]
fn csv_never_guards_money_count_or_date_cells() {
    let table = ExportTable {
        columns: vec![
            ExportColumn {
                header: "Price".into(),
                kind: CellKind::Money,
                width: 10,
                nowrap: None,
            },
            ExportColumn {
                header: "Count".into(),
                kind: CellKind::Count,
                width: 10,
                nowrap: None,
            },
            ExportColumn {
                header: "When".into(),
                kind: CellKind::DateTime,
                width: 10,
                nowrap: None,
            },
        ],
        rows: vec![vec![
            Cell::Money("-5.00".into()),
            Cell::Count(-3),
            Cell::DateTime("2026-01-02T03:04".into()),
        ]],
        ..sample()
    };
    let text = text_of(&to_csv(&table));
    assert_eq!(
        text.split("\r\n").nth(1).unwrap(),
        format!("-5.00,-3,2026-01-02 03:04,{MADE}")
    );
}

#[test]
fn a_seated_attendee_list_has_its_level_and_each_tickets_price_in_the_csv() {
    // attendees-export.test.tsx (038 FR-030).
    let text = text_of(&to_csv(&table("attendees-seated")));
    let lines: Vec<&str> = text.trim_start_matches('\u{feff}').split("\r\n").collect();
    assert!(lines[0].starts_with("Order placed,Customer,Name on tickets,Tier,Price level,Seat,"));
    let seated: Vec<&&str> = lines.iter().filter(|l| l.contains("EEEEEEEE")).collect();
    assert_eq!(seated.len(), 2);
    assert!(seated[0].contains(",,Courtside,\"Section 115, Row D, Seat 2\",BCDFGHJK2345,"));
    assert!(seated[0].contains(",Confirmed,95.00,EEEEEEEE,"));
    assert!(seated[1].contains(",,Lower sideline,\"Section 115, Row F, Seat 7\",LMNPQRST6789,"));
    assert!(seated[1].contains(",Confirmed,60.00,EEEEEEEE,"));
}

#[test]
fn a_seated_sales_report_keeps_one_csv_row_per_event() {
    // reports-export.test.tsx (023 FR-005; 038 R17).
    let text = text_of(&to_csv(&table("sales-seated")));
    let lines: Vec<&str> = text.trim().split("\r\n").collect();
    assert_eq!(lines.len(), 1 + 3 + 1);
    assert!(lines[1].starts_with("Season Opener,Yum Center,"));
    assert!(lines[1].contains(",25,100,1321.50,12,"));
    assert!(!text.contains("Courtside"));
}

// ------------------------------------------------------------------ XLSX (X2)

struct Book {
    names: Vec<String>,
    sheets: Vec<Vec<Vec<Data>>>,
    files: std::collections::HashMap<String, String>,
}

fn book(bytes: Vec<u8>) -> Book {
    let mut wb: Xlsx<_> = open_workbook_from_rs(Cursor::new(bytes.clone())).unwrap();
    let names = wb.sheet_names();
    let sheets = names
        .iter()
        .map(|n| {
            let range = wb.worksheet_range(n).unwrap();
            range.rows().map(|r| r.to_vec()).collect()
        })
        .collect();
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut files = std::collections::HashMap::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).unwrap();
        let mut s = String::new();
        if f.read_to_string(&mut s).is_ok() {
            files.insert(f.name().unwrap().to_string(), s);
        }
    }
    Book {
        names,
        sheets,
        files,
    }
}

/// A date cell's wall-clock time (Excel's serial days from 1899-12-30), to the minute.
fn wall_clock(cell: &Data) -> NaiveDateTime {
    match cell {
        Data::DateTime(d) => {
            let base = NaiveDate::from_ymd_opt(1899, 12, 30)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap();
            base + Duration::seconds((d.as_f64() * 86_400.0).round() as i64)
        }
        other => panic!("not a date cell: {other:?}"),
    }
}

fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(y, mo, d)
        .unwrap()
        .and_hms_opt(h, mi, 0)
        .unwrap()
}

fn s(v: &str) -> Data {
    Data::String(v.into())
}

#[test]
fn xlsx_has_the_table_sheet_first_and_about_second() {
    assert_eq!(
        XLSX_TYPE,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    let b = book(to_xlsx(&sample()).unwrap());
    assert_eq!(b.names, ["Attendees", "About"]);
}

#[test]
fn xlsx_writes_the_header_row_then_typed_cells() {
    let b = book(to_xlsx(&sample()).unwrap());
    let rows = &b.sheets[0];
    assert_eq!(
        rows[0],
        [
            s("Order placed"),
            s("Name on tickets"),
            s("Seat"),
            s("Ticket code"),
            s("Checked in"),
            s("Price"),
            s("Tickets"),
        ]
    );
    // R4: the venue's wall-clock time; spreadsheets have no zones (xlsx.tz: the writer never
    // reads the device's zone, so the cell is the same in any zone).
    assert_eq!(wall_clock(&rows[1][0]), at(2026, 9, 30, 10, 0));
    assert_eq!(
        rows[1][1..4],
        [s("Jordan Lee"), Data::Empty, s("ABCDEFGH2345")]
    );
    assert_eq!(wall_clock(&rows[1][4]), at(2026, 11, 1, 16, 45));
    assert_eq!(rows[1][5..], [Data::Float(84.3), Data::Float(1200.0)]);
    // FR-010: a formula-looking name is read back as the text typed, not run.
    assert_eq!(wall_clock(&rows[2][0]), at(2026, 10, 1, 20, 30));
    assert_eq!(
        rows[2][1..],
        [
            s("=SUM(1,1)"),
            s("Section A, Row 3, Seat 7"),
            s("STUVWXYZ2345"),
            Data::Empty,
            Data::Float(1045.0),
            Data::Float(0.0),
        ]
    );
    assert_eq!(
        rows[3][1..4],
        [s("Zoë “Zo” O’Brien"), s("Line one\nline two"), s("-12")]
    );
    assert_eq!(rows[3][5..], [Data::Float(0.0), Data::Float(-1.0)]);
}

#[test]
fn xlsx_puts_the_title_the_lines_and_the_made_at_time_on_about() {
    let b = book(to_xlsx(&sample()).unwrap());
    let first: Vec<Data> = b.sheets[1].iter().map(|r| r[0].clone()).collect();
    assert_eq!(
        first,
        [
            s("Attendees: Export Test, Café"),
            s("Made at Oct 30, 2026, 2:05 PM EDT"),
            s("Made by admin1"),
            s("Times are in Central Time (the venue's time zone)."),
            s("Exported at 2026-10-30T14:05:00-04:00"),
        ]
    );
}

/// The number format a cell's style carries, from the file's XML.
fn format_of(b: &Book, sheet: &str, cell: &str) -> String {
    let sheet = &b.files[sheet];
    let at = sheet
        .find(&format!("<c r=\"{cell}\""))
        .unwrap_or_else(|| panic!("no {cell}"));
    let tag = &sheet[at..at + sheet[at..].find('>').unwrap()];
    let style: usize = tag
        .split(" s=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .map_or(0, |s| s.parse().unwrap());
    let styles = &b.files["xl/styles.xml"];
    let xfs = &styles[styles.find("<cellXfs").unwrap()..];
    let xf = xfs.split("<xf ").nth(style + 1).unwrap();
    let id = xf
        .split("numFmtId=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    let fmt = format!("numFmtId=\"{id}\" formatCode=\"");
    styles
        .find(&fmt)
        .map(|i| {
            styles[i + fmt.len()..]
                .split('"')
                .next()
                .unwrap()
                .to_string()
        })
        .unwrap_or_else(|| format!("builtin {id}"))
}

#[test]
fn xlsx_formats_money_and_dates_freezes_the_header_and_writes_shared_strings() {
    let b = book(to_xlsx(&sample()).unwrap());
    let styles = &b.files["xl/styles.xml"];
    assert!(styles.contains("formatCode=\"&quot;$&quot;#,##0.00\""));
    assert!(styles.contains("formatCode=\"yyyy-mm-dd hh:mm\""));
    let sheet = &b.files["xl/worksheets/sheet1.xml"];
    let pane = &sheet[sheet.find("<pane ").unwrap()..];
    let pane = &pane[..pane.find('>').unwrap()];
    assert!(
        pane.contains("ySplit=\"1\"") && pane.contains("state=\"frozen\""),
        "{pane}"
    );
    let b3 = &sheet[sheet.find("<c r=\"B3\"").unwrap()..];
    assert!(b3[..b3.find('>').unwrap()].contains(" t=\"s\""));
    assert!(!sheet.contains("<f>"));
    let sheet1 = "xl/worksheets/sheet1.xml";
    assert_eq!(format_of(&b, sheet1, "F2"), "&quot;$&quot;#,##0.00");
    assert_eq!(format_of(&b, sheet1, "A2"), "yyyy-mm-dd hh:mm");
    assert_eq!(format_of(&b, sheet1, "E2"), "yyyy-mm-dd hh:mm");
    // The header row is bold; the column widths are the model's, and About's is 80.
    assert!(styles.contains("<b/>"));
    assert!(
        sheet.contains("width=\"18.7109375\"") || sheet.contains("width=\"18"),
        "{sheet}"
    );
    assert!(b.files["xl/worksheets/sheet2.xml"].contains("width=\"80"));
}

#[test]
fn xlsx_has_the_same_cells_as_the_react_table_for_every_fixture() {
    for name in ALL {
        let t = table(name);
        let b = book(to_xlsx(&t).unwrap());
        assert_eq!(b.names, [t.sheet_name.as_str(), "About"], "{name}");
        let rows = &b.sheets[0];
        let headers: Vec<Data> = t.columns.iter().map(|c| s(&c.header)).collect();
        assert_eq!(rows[0], headers, "{name}");
        assert_eq!(rows.len(), t.rows.len() + 1, "{name}");
        for (row, cells) in t.rows.iter().zip(&rows[1..]) {
            for (cell, got) in row.iter().zip(cells) {
                match cell {
                    Cell::Text(v) if v.is_empty() => assert_eq!(*got, Data::Empty),
                    Cell::Text(v) => assert_eq!(*got, s(v), "{name}"),
                    Cell::DateTime(v) if v.is_empty() => assert_eq!(*got, Data::Empty),
                    Cell::DateTime(v) => assert_eq!(
                        wall_clock(got),
                        NaiveDateTime::parse_from_str(v, "%Y-%m-%dT%H:%M").unwrap()
                    ),
                    Cell::Money(v) => assert_eq!(*got, Data::Float(v.parse().unwrap())),
                    Cell::Count(v) => assert_eq!(*got, Data::Float(*v as f64)),
                }
            }
        }
        let about: Vec<Data> = b.sheets[1].iter().map(|r| r[0].clone()).collect();
        let mut expected = vec![s(&t.title)];
        expected.extend(t.subtitle.iter().map(|l| s(l)));
        expected.push(s(&format!("Exported at {}", t.made_at)));
        assert_eq!(about, expected, "{name}");
    }
}

#[test]
fn a_seated_attendee_list_has_its_level_and_price_in_excel() {
    let b = book(to_xlsx(&table("attendees-seated")).unwrap());
    let rows = &b.sheets[0];
    let head = &rows[0];
    let level = head.iter().position(|c| *c == s("Price level")).unwrap();
    let price = head.iter().position(|c| *c == s("Price")).unwrap();
    assert_eq!(
        level,
        head.iter().position(|c| *c == s("Tier")).unwrap() + 1
    );
    let seated: Vec<(Data, Data)> = rows
        .iter()
        .filter(|r| r.last() == Some(&s("EEEEEEEE")))
        .map(|r| (r[level].clone(), r[price].clone()))
        .collect();
    assert_eq!(
        seated,
        [
            (s("Courtside"), Data::Float(95.0)),
            (s("Lower sideline"), Data::Float(60.0))
        ]
    );
}

#[test]
fn the_sales_report_names_the_signed_in_admin_on_about() {
    let b = book(to_xlsx(&table("sales-seated")).unwrap());
    assert!(b.sheets[1].iter().any(|r| r[0] == s("Made by admin1")));
}

// ------------------------------------------------------------------ PDF (X3)

#[test]
fn pdf_text_keeps_latin_greek_cyrillic_and_common_punctuation() {
    let s = "Zoë – Łukasz O’Brien Ελένη Пётр “quoted”…";
    assert_eq!(pdf_text(s), (s.to_string(), false));
}

#[test]
fn pdf_text_turns_a_character_outside_the_font_into_a_question_mark() {
    assert_eq!(pdf_text("山田 Zoë 😀"), ("?? Zoë ?".to_string(), true));
}

#[test]
fn pdf_text_composes_a_decomposed_letter_before_checking_it() {
    assert_eq!(pdf_text("Zoe\u{308}"), ("Zoë".to_string(), false));
    assert_eq!(pdf_text("a\nb"), ("a\nb".to_string(), false));
}

#[test]
fn the_fonts_characters_are_the_react_apps() {
    let theirs: BTreeSet<u32> = serde_json::from_value(read_json("expected/glyphs.json")).unwrap();
    assert_eq!(*font_glyphs(), theirs);
}

#[test]
fn every_pdf_layout_equals_the_react_layout() {
    for name in ALL {
        let ours = serde_json::to_value(pdf_layout(&table(name))).unwrap();
        let theirs = read_json(&format!("expected/{name}.pdf-layout.json"));
        assert_eq!(ours, theirs, "{name}");
    }
}

#[test]
fn the_layout_adds_the_note_when_a_character_was_replaced() {
    let mut t = sample();
    t.rows = vec![t.rows[0].clone()];
    t.rows[0][0] = Cell::Text("山".into());
    let layout = pdf_layout(&t);
    assert_eq!(layout.body[0][0], "?");
    assert_eq!(layout.heading.last().unwrap(), REPLACED_NOTE);
    assert_eq!(
        REPLACED_NOTE,
        "Some characters are shown as ?; the CSV and Excel files have the exact text."
    );
    assert_eq!(layout.nowrap, [true, false, false, true, true, true, true]);
}

struct Pdf {
    raw: String,
    doc: lopdf::Document,
}

fn pdf(table: &ExportTable) -> Pdf {
    let bytes = to_pdf(table).unwrap();
    Pdf {
        raw: String::from_utf8_lossy(&bytes).into_owned(),
        doc: lopdf::Document::load_mem(&bytes).unwrap(),
    }
}

impl Pdf {
    fn pages(&self) -> usize {
        self.doc.get_pages().len()
    }

    fn page_text(&self, page: u32) -> String {
        self.doc.extract_text(&[page]).unwrap()
    }

    fn lines(&self, page: u32) -> Vec<String> {
        self.page_text(page).lines().map(str::to_string).collect()
    }

    fn info(&self, key: &[u8]) -> String {
        let info = self
            .doc
            .trailer
            .get(b"Info")
            .unwrap()
            .as_reference()
            .unwrap();
        let dict = self.doc.get_dictionary(info).unwrap();
        lopdf::decode_text_string(dict.get(key).unwrap()).unwrap()
    }
}

/// Text with every run of whitespace one space, to find a row however its cells were wrapped.
fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn pdf_is_letter_landscape_with_noto_sans_embedded_one_page_for_10_rows() {
    assert_eq!(PDF_TYPE, "application/pdf");
    let p = pdf(&sample_of(10));
    assert!(p.raw.starts_with("%PDF-"));
    let page = p.doc.get_pages()[&1];
    let media = p
        .doc
        .get_dictionary(page)
        .unwrap()
        .get(b"MediaBox")
        .unwrap();
    let media: Vec<f32> = media
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o.as_float().unwrap())
        .collect();
    assert_eq!(media, [0.0, 0.0, 792.0, 612.0]);
    let mut fonts: Vec<String> = p
        .doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter(|d| d.get(b"FontFile2").is_ok())
        .map(|d| String::from_utf8_lossy(d.get(b"FontName").unwrap().as_name().unwrap()).into())
        .collect();
    fonts.sort();
    assert_eq!(fonts, ["NotoSans-Bold", "NotoSans-Regular"]);
    assert_eq!(p.pages(), 1);
    assert_eq!(p.info(b"Title"), "Attendees: Export Test, Café");
    assert_eq!(p.info(b"Creator"), "QueuePass");
}

#[test]
fn pdf_breaks_200_rows_across_pages_with_the_header_and_page_n_of_m_on_each() {
    let t = sample_of(200);
    let p = pdf(&t);
    let pages = p.pages();
    assert!(pages >= 2);
    let mut rows = 0;
    for n in 1..=pages as u32 {
        let lines = p.lines(n);
        assert_eq!(
            lines.last().unwrap(),
            &format!("Page {n} of {pages}"),
            "page {n}"
        );
        let head: Vec<&str> = t.columns.iter().map(|c| c.header.as_str()).collect();
        let at = lines
            .iter()
            .position(|l| l == "Order placed")
            .expect("header on every page");
        assert_eq!(lines[at..at + head.len()], head, "page {n}");
        rows += lines.iter().filter(|l| *l == "ABCDEFGH2345").count();
    }
    assert_eq!(rows, 200);
    // The heading is on the first page only.
    assert!(p.page_text(1).contains("Made by admin1"));
    assert!(!p.page_text(2).contains("Made by admin1"));
}

#[test]
fn every_pdf_has_the_title_the_notes_the_header_and_every_row() {
    for name in ALL {
        let t = table(name);
        let layout = pdf_layout(&t);
        let p = pdf(&t);
        let pages = p.pages();
        let all: String = (1..=pages as u32).map(|n| p.page_text(n)).collect();
        let first = p.page_text(1);
        for line in &layout.heading {
            assert!(squash(&first).contains(&squash(line)), "{name}: {line}");
        }
        for n in 1..=pages as u32 {
            let text = squash(&p.page_text(n));
            assert!(
                text.contains(&squash(&layout.head.join(" "))),
                "{name} page {n}"
            );
            assert!(
                text.ends_with(&format!("Page {n} of {pages}")),
                "{name} page {n}"
            );
        }
        let all = squash(&all);
        for row in &layout.body {
            let cells: Vec<&str> = row
                .iter()
                .map(String::as_str)
                .filter(|c| !c.is_empty())
                .collect();
            let row = squash(&cells.join(" "));
            assert!(all.contains(&row), "{name}: {row}");
        }
    }
}

#[test]
fn a_pdf_with_characters_outside_the_font_shows_question_marks_and_says_so() {
    let p = pdf(&table("attendees"));
    let text = p.page_text(1);
    assert!(text.contains("?? Zoë ?"), "{text}");
    assert!(squash(&text).contains(REPLACED_NOTE));
    // The CSV keeps the exact text.
    assert!(text_of(&to_csv(&table("attendees"))).contains("山田 Zoe\u{308} 😀"));
}

#[test]
fn the_pdf_header_is_the_react_files_indigo_and_the_body_ink() {
    let p = pdf(&sample());
    let page = p.doc.get_pages()[&1];
    let content = lopdf::content::Content::decode(&p.doc.get_page_content(page)).unwrap();
    let colors: Vec<Vec<f32>> = content
        .operations
        .iter()
        .filter(|op| op.operator == "rg")
        .map(|op| op.operands.iter().map(|o| o.as_float().unwrap()).collect())
        .collect();
    let near =
        |c: &Vec<f32>, rgb: [f32; 3]| c.iter().zip(rgb).all(|(a, b)| (a * 255.0 - b).abs() < 0.6);
    assert!(
        colors.iter().any(|c| near(c, [79.0, 70.0, 229.0])),
        "{colors:?}"
    );
    assert!(
        colors.iter().any(|c| near(c, [17.0, 24.0, 39.0])),
        "{colors:?}"
    );
}

// ------------------------------------------------------------------ pdf.fit.test.ts

const PRINTABLE: f32 = 792.0 - 2.0 * 36.0;

fn chicago_event() -> Event {
    match serde_json::from_value(read_json("attendees.json")).unwrap() {
        Input::Attendees { event, .. } => event,
        _ => unreachable!(),
    }
}

fn export_orders() -> Vec<Order> {
    match serde_json::from_value(read_json("attendees.json")).unwrap() {
        Input::Attendees { orders, .. } => orders.into_iter().take(5).collect(),
        _ => unreachable!(),
    }
}

/// The widest values each column can hold in practice.
fn widest() -> Order {
    Order {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd".into(),
        customer_username: "m".repeat(24),
        holder_name: Some("Maximilian Featherstonehaugh-Wolfeschlegelsteinhausen".into()),
        tier_name: Some("General admission".into()),
        unit_price: Some("9999.99".into()),
        tickets: vec![Ticket {
            code: "WWWWMMMMWWWW".into(),
            status: TicketStatus::Valid,
            checked_in_at: Some(Utc.with_ymd_and_hms(2026, 11, 1, 22, 45, 0).unwrap()),
            // Spec 038: labels of up to 5 characters, a level name of up to 50.
            seat: Some(SoldSeat {
                section: "MMMM".into(),
                row_label: "MMMMM".into(),
                seat_label: "MMMMM".into(),
            }),
            price: "9999.99".into(),
            level_name: Some("Lower Sideline Terrace Club, Courtside Premium".into()),
        }],
        ..export_orders()[0].clone()
    }
}

fn epoch() -> DateTime<Utc> {
    DateTime::UNIX_EPOCH
}

#[test]
fn the_pdf_table_fits_the_page_for_the_sample_attendee_list() {
    let t = attendee_table(
        &chicago_event(),
        &export_orders(),
        epoch(),
        "admin1",
        "UTC",
        None,
    );
    let width: f32 = column_widths(&t).iter().sum();
    assert!(width <= PRINTABLE + 0.01, "{width}");
    to_pdf(&t).unwrap();
}

#[test]
fn the_pdf_table_fits_the_page_for_the_widest_attendee_values() {
    let mut orders = vec![widest()];
    orders.extend(export_orders());
    let t = attendee_table(&chicago_event(), &orders, epoch(), "admin1", "UTC", None);
    let widths = column_widths(&t);
    let width: f32 = widths.iter().sum();
    assert!(width <= PRINTABLE + 0.01, "{width}: {widths:?}");
    let p = pdf(&t);
    assert!(squash(&p.page_text(1)).contains("WWWWMMMMWWWW"));
}

#[test]
fn the_pdf_table_fits_the_page_for_a_sales_report_with_a_large_revenue() {
    let mut report = match serde_json::from_value(read_json("sales.json")).unwrap() {
        Input::Sales { report, .. } => report,
        _ => unreachable!(),
    };
    report.totals.revenue = "99999999.99".into();
    report.totals.ticket_capacity = 9_999_999;
    let t = sales_table(&report, "admin1", "UTC");
    let width: f32 = column_widths(&t).iter().sum();
    assert!(width <= PRINTABLE + 0.01, "{width}");
    let p = pdf(&t);
    assert!(p.page_text(1).contains("$99,999,999.99"));
    assert!(p.page_text(1).contains("9,999,999"));
}

// ------------------------------------------------------------------ size.test.ts (X5)

const NAMES: [&str; 5] = [
    "Jordan Lee",
    "Zoë O’Brien",
    "=SUM(1,1)",
    "Ελένη Παπαδοπούλου",
    "Пётр Иванов",
];

/// The React size test's `ordersOf(tickets)`: orders of one to four tickets until there are
/// `tickets`, a third of them seated with a level, some refunded, half the tickets checked in.
fn orders_of(tickets: usize) -> Vec<Order> {
    let mut orders = Vec::new();
    let (mut i, mut n) = (0usize, 0usize);
    let start = Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap();
    while n < tickets {
        let quantity = (1 + i % 4).min(tickets - n);
        let at = start + Duration::minutes(i as i64);
        let refunded = i % 11 == 0;
        orders.push(Order {
            id: format!("{i:08x}-0000-4000-8000-000000000000"),
            tier_name: (i % 3 != 0).then(|| "Floor".to_string()),
            customer_username: format!("customer{}", i % 5 + 1),
            holder_name: (i % 7 != 0).then(|| NAMES[i % NAMES.len()].to_string()),
            unit_price: Some("84.30".into()),
            status: if refunded {
                OrderStatus::Refunded
            } else {
                OrderStatus::Confirmed
            },
            created_at: at,
            tickets: (0..quantity)
                .map(|k| Ticket {
                    code: format!("ABCD{:08}", n + k),
                    status: if refunded {
                        TicketStatus::Void
                    } else {
                        TicketStatus::Valid
                    },
                    checked_in_at: (k % 2 == 1).then(|| at + Duration::hours(1)),
                    seat: (i % 3 == 1).then(|| SoldSeat {
                        section: "A".into(),
                        row_label: (1 + i % 40).to_string(),
                        seat_label: (1 + k).to_string(),
                    }),
                    price: "84.30".into(),
                    level_name: (i % 3 == 1).then(|| "Lower sideline".to_string()),
                })
                .collect(),
        });
        n += quantity;
        i += 1;
    }
    orders
}

fn sized(tickets: usize) {
    let start = Instant::now();
    let t = attendee_table(
        &chicago_event(),
        &orders_of(tickets),
        epoch(),
        "admin1",
        "UTC",
        None,
    );
    assert_eq!(t.rows.len(), tickets);
    let mut times = vec![format!(
        "{tickets} table: {:.2} s",
        start.elapsed().as_secs_f32()
    )];
    let mut timed = |format: &str, make: &dyn Fn() -> Vec<u8>| {
        let start = Instant::now();
        let bytes = make();
        assert!(!bytes.is_empty());
        times.push(format!(
            "{tickets} {format}: {:.2} s, {} KB",
            start.elapsed().as_secs_f32(),
            bytes.len() / 1024
        ));
        bytes
    };
    let csv = timed("CSV", &|| to_csv(&t));
    assert_eq!(text_of(&csv).matches("\r\n").count(), tickets + 1);
    let xlsx = timed("XLSX", &|| to_xlsx(&t).unwrap());
    assert!(xlsx.starts_with(b"PK"));
    let pdf = timed("PDF", &|| to_pdf(&t).unwrap());
    assert!(pdf.starts_with(b"%PDF-"));
    println!("[037 size]\n{}", times.join("\n"));
}

#[test]
fn size_5000_tickets_in_all_three_formats() {
    sized(5_000);
}

#[test]
fn size_25000_tickets_in_all_three_formats() {
    sized(25_000);
}

#[test]
fn the_made_at_time_parses_back() {
    assert!(parse_instant(MADE).is_some());
}

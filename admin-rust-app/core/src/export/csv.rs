//! Spec 037 (research R7, X1), port of `admin-app/src/export/csv.ts`: the `csv` crate quotes
//! (RFC 4180: only a field with a comma, quote, CR, or LF; quotes doubled), and this module adds
//! what the React writer adds by hand: a UTF-8 byte-order mark, CRLF line ends, `Exported at` on
//! every row, and the formula guard.

use csv::{QuoteStyle, Terminator, WriterBuilder};

use super::table::{Cell, ExportTable};

pub const CSV_TYPE: &str = "text/csv;charset=utf-8";

const BOM: &[u8] = "\u{feff}".as_bytes();

/// Spec 023 research R6 (OWASP CSV injection): a text cell a spreadsheet could read as a formula.
fn looks_like_formula(s: &str) -> bool {
    s.starts_with(['=', '+', '-', '@', '\t', '\r'])
}

/// FR-007: `YYYY-MM-DD HH:MM`, money as its two-decimal string, counts as integers.
fn value(cell: &Cell) -> String {
    match cell {
        // FR-010: the one place a CSV differs from the page; spreadsheets show the apostrophe.
        Cell::Text(v) if looks_like_formula(v) => format!("'{v}"),
        Cell::Text(v) | Cell::Money(v) => v.clone(),
        Cell::DateTime(v) => v.replacen('T', " ", 1),
        Cell::Count(n) => n.to_string(),
    }
}

/// Spec 023 FR-007 (research R9): UTF-8 with a byte-order mark so Excel reads the letters right,
/// one header row, CRLF line ends, and `Exported at` (the made-at time) last on every row.
pub fn to_csv(table: &ExportTable) -> Vec<u8> {
    let mut out = BOM.to_vec();
    {
        let mut w = WriterBuilder::new()
            .terminator(Terminator::CRLF)
            .quote_style(QuoteStyle::Necessary)
            .flexible(true)
            .from_writer(&mut out);
        let head = table.columns.iter().map(|c| c.header.as_str());
        // Writing into a Vec cannot fail.
        w.write_record(head.chain(["Exported at"]))
            .expect("CSV into memory");
        for row in &table.rows {
            let fields = row.iter().map(value).chain([table.made_at.clone()]);
            w.write_record(fields).expect("CSV into memory");
        }
        w.flush().expect("CSV into memory");
    }
    out
}

//! Spec 037 (research R7, X2), port of `admin-app/src/export/xlsx.ts` with `rust_xlsxwriter`
//! (its `wasm` feature in the browser): the table with a frozen bold header row and typed
//! cells in the React file's number formats, then an About sheet.

use rust_xlsxwriter::{ExcelDateTime, Format, Workbook, Worksheet, XlsxError};

use super::table::{Cell, ExportError, ExportTable};

pub const XLSX_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MONEY_FORMAT: &str = "\"$\"#,##0.00";
const DATE_FORMAT: &str = "yyyy-mm-dd hh:mm";
const ABOUT_WIDTH: f64 = 80.0;

/// Research R4 of spec 023: a spreadsheet date has no zone, so the cell is the venue's
/// wall-clock time as it is, never converted through the device's zone.
fn wall_clock(local: &str) -> Option<ExcelDateTime> {
    let (date, time) = local.split_once('T')?;
    let mut d = date.split('-').map(str::parse::<u16>);
    let mut t = time.split(':').map(str::parse::<u16>);
    let (y, mo, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let (h, mi) = (t.next()?.ok()?, t.next()?.ok()?);
    ExcelDateTime::from_ymd(y, u8::try_from(mo).ok()?, u8::try_from(day).ok()?)
        .ok()?
        .and_hms(h, u8::try_from(mi).ok()?, 0)
        .ok()
}

struct Formats {
    bold: Format,
    money: Format,
    date: Format,
}

/// FR-008, FR-010: typed cells; text is always a string cell, never a formula; an empty text
/// or date is an empty cell.
fn write_cell(
    sheet: &mut Worksheet,
    row: u32,
    col: u16,
    cell: &Cell,
    f: &Formats,
) -> Result<(), XlsxError> {
    match cell {
        Cell::Text(v) | Cell::DateTime(v) if v.is_empty() => {}
        Cell::Text(v) => {
            sheet.write_string(row, col, v)?;
        }
        Cell::DateTime(v) => match wall_clock(v) {
            Some(at) => {
                sheet.write_datetime_with_format(row, col, at, &f.date)?;
            }
            None => {
                sheet.write_string(row, col, v)?;
            }
        },
        // R5: at most two decimals and far below 2^53 cents, so the number shown is exact.
        Cell::Money(v) => match v.parse::<f64>() {
            Ok(n) => {
                sheet.write_number_with_format(row, col, n, &f.money)?;
            }
            Err(_) => {
                sheet.write_string(row, col, v)?;
            }
        },
        Cell::Count(n) => {
            sheet.write_number(row, col, *n as f64)?;
        }
    }
    Ok(())
}

fn workbook(table: &ExportTable) -> Result<Vec<u8>, XlsxError> {
    let f = Formats {
        bold: Format::new().set_bold(),
        money: Format::new().set_num_format(MONEY_FORMAT),
        date: Format::new().set_num_format(DATE_FORMAT),
    };
    let mut book = Workbook::new();

    let sheet = book.add_worksheet();
    sheet.set_name(&table.sheet_name)?;
    for (col, column) in table.columns.iter().enumerate() {
        let col = col as u16;
        sheet.write_string_with_format(0, col, &column.header, &f.bold)?;
        sheet.set_column_width(col, column.width)?;
    }
    for (r, row) in table.rows.iter().enumerate() {
        for (col, cell) in row.iter().enumerate() {
            write_cell(sheet, r as u32 + 1, col as u16, cell, &f)?;
        }
    }
    sheet.set_freeze_panes(1, 0)?;

    let about = book.add_worksheet();
    about.set_name("About")?;
    about.set_column_width(0, ABOUT_WIDTH)?;
    about.write_string_with_format(0, 0, &table.title, &f.bold)?;
    let lines = table
        .subtitle
        .iter()
        .cloned()
        .chain([format!("Exported at {}", table.made_at)]);
    for (r, line) in lines.enumerate() {
        about.write_string(r as u32 + 1, 0, line)?;
    }
    book.save_to_buffer()
}

/// Spec 023 FR-008 (research R2, R4, R5): the table with a frozen bold header row, then an
/// About sheet saying what the file is, when and by whom it was made, and the zone note.
pub fn to_xlsx(table: &ExportTable) -> Result<Vec<u8>, ExportError> {
    workbook(table).map_err(|e| ExportError::Xlsx(e.to_string()))
}

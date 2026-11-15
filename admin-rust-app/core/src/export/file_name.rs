//! Spec 037 (research R7, X4), port of `admin-app/src/export/file-name.ts`.

use chrono::{DateTime, Utc};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use super::made::to_local_date_time;

/// Which report a file is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReportKind {
    Attendees,
    SalesReport,
}

/// The three download formats.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Xlsx,
    Pdf,
}

impl ExportFormat {
    /// The file name's extension.
    pub fn ext(self) -> &'static str {
        match self {
            ExportFormat::Csv => "csv",
            ExportFormat::Xlsx => "xlsx",
            ExportFormat::Pdf => "pdf",
        }
    }

    /// The download's media type.
    pub fn media_type(self) -> &'static str {
        match self {
            ExportFormat::Csv => super::csv::CSV_TYPE,
            ExportFormat::Xlsx => super::xlsx::XLSX_TYPE,
            ExportFormat::Pdf => super::pdf::PDF_TYPE,
        }
    }
}

const SLUG_MAX: usize = 60;

/// Research R8 of spec 023: the event name NFKD-normalized, diacritics removed, lower case,
/// every run of anything but `a-z` and `0-9` one hyphen, trimmed, cut to 60 characters;
/// `event` if empty.
pub fn slug(name: &str) -> String {
    let lower: String = name
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase();
    let mut hyphened = String::new();
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            hyphened.push(c);
        } else if !hyphened.ends_with('-') {
            hyphened.push('-');
        }
    }
    // Only ASCII is left, so bytes are characters.
    let cut = &hyphened[..hyphened.len().min(SLUG_MAX + 1)];
    let trimmed = cut.trim_matches('-');
    let s = trimmed[..trimmed.len().min(SLUG_MAX)].trim_end_matches('-');
    if s.is_empty() {
        "event".into()
    } else {
        s.into()
    }
}

/// Spec 023 FR-012 (research R8): `attendees-<slug>-<YYYY-MM-DD-HHmm>.<ext>` or
/// `sales-report-<YYYY-MM-DD-HHmm>.<ext>`, the time being the made-at time in the admin's zone,
/// so every download from one page load has the same name.
pub fn file_name(
    kind: ReportKind,
    event_name: Option<&str>,
    made_at: DateTime<Utc>,
    zone: &str,
    format: ExportFormat,
) -> String {
    let local = to_local_date_time(made_at, zone);
    let (date, time) = local.split_once('T').unwrap_or((&local, ""));
    let stamp = format!("{date}-{}", time.replacen(':', "", 1));
    let ext = format.ext();
    match kind {
        ReportKind::Attendees => {
            format!("attendees-{}-{stamp}.{ext}", slug(event_name.unwrap_or("")))
        }
        ReportKind::SalesReport => format!("sales-report-{stamp}.{ext}"),
    }
}

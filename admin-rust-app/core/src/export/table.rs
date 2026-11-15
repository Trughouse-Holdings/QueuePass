//! Spec 037 (research R7), port of `admin-app/src/export/table.ts` (spec 023 data-model.md): the
//! one table model every export is made from. The builders (`rows.rs`) decide every figure; the
//! writers (`csv.rs`, `xlsx.rs`, `pdf.rs`) only format it. Serialized, it has the React model's
//! JSON shape, so the parity tests compare the two directly (SC-004).

use serde::{Deserialize, Serialize};

/// One cell of a table, typed so each writer formats it its own way.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Cell {
    Text(String),
    /// The venue's wall-clock time, `YYYY-MM-DDTHH:mm`, or `""` when empty (023 research R4).
    DateTime(String),
    /// A two-decimal amount, `"45.00"`, never a float (023 research R5).
    Money(String),
    Count(i64),
}

impl Cell {
    pub fn kind(&self) -> CellKind {
        match self {
            Cell::Text(_) => CellKind::Text,
            Cell::DateTime(_) => CellKind::DateTime,
            Cell::Money(_) => CellKind::Money,
            Cell::Count(_) => CellKind::Count,
        }
    }
}

/// A column's kind: `Cell`'s variants without their values.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CellKind {
    Text,
    DateTime,
    Money,
    Count,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportColumn {
    pub header: String,
    pub kind: CellKind,
    /// In characters: the Excel column width.
    pub width: u32,
    /// PDF only: sized to its content and never wrapped (codes, dates, numbers; 023 R10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nowrap: Option<bool>,
}

impl ExportColumn {
    pub(crate) fn new(header: &str, kind: CellKind, width: u32) -> Self {
        Self {
            header: header.to_string(),
            kind,
            width,
            nowrap: None,
        }
    }

    pub(crate) fn nowrap(mut self) -> Self {
        self.nowrap = Some(true);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTable {
    /// `"Attendees: Season Opener"` | `"Sales report"`.
    pub title: String,
    /// Made at, made by (the signed-in username), and the time-zone note.
    pub subtitle: Vec<String>,
    /// RFC 3339 with the admin's own offset (023 research R7).
    pub made_at: String,
    /// `"Attendees"` | `"Sales"`.
    pub sheet_name: String,
    pub columns: Vec<ExportColumn>,
    pub rows: Vec<Vec<Cell>>,
}

/// A writer that could not make its file: the export menu then says "Couldn't make the …".
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExportError {
    Xlsx(String),
    Pdf(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::Xlsx(e) => write!(f, "Excel file not made: {e}"),
            ExportError::Pdf(e) => write!(f, "PDF not made: {e}"),
        }
    }
}

impl std::error::Error for ExportError {}

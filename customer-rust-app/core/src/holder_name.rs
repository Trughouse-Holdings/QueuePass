//! Spec 040 T042 (parity P5; spec 017 FR-001 to FR-003, research R2): the name on tickets, ported
//! from `packages/shared/src/holder-name.ts`, the one definition the Backend's refusal
//! (`400 HOLDER_NAME_INVALID`) and the form share, and the Name on tickets field's rules from
//! `GetTickets.tsx`' `nameField` (shown once left, linked to the field). The Cart's field is the
//! same (session D reuses [`HolderNameField`] through `components/holder_name_field.rs`).

use std::sync::LazyLock;

use regress::Regex;
use unicode_normalization::UnicodeNormalization;

/// Ports `HOLDER_NAME_MAX`: at most 100 code points (PostgreSQL's `char_length`).
pub const HOLDER_NAME_MAX: usize = 100;

/// The hint under the field (parity P5).
pub const HOLDER_NAME_HINT: &str =
    "Your name, as on the photo ID you'll show at the gate. It goes on every ticket.";

/// Issue #182: the line beside Buy tickets (Cart) and Confirm order (general admission) while the
/// name is all that keeps the button disabled. Ports `NAME_NEEDED_TO_BUY` from
/// `packages/shared/src/holder-name.ts`, word for word (spec 040; a test reads that file).
pub const NAME_NEEDED_TO_BUY: &str = "Enter the name on tickets above to buy.";

/// Ports `nameNeededToBuy`: the line, only while the name is not valid, the button would be usable
/// with one, and no BUY wait shows its own message.
pub fn name_needed_to_buy(
    name_ok: bool,
    usable_with_name: bool,
    waiting: bool,
) -> Option<&'static str> {
    (!name_ok && usable_with_name && !waiting).then_some(NAME_NEEDED_TO_BUY)
}

/// Ports `HolderNameProblem`, in the order the checks run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HolderNameProblem {
    Missing,
    TooLong,
    ControlCharacter,
    NoLetter,
}

/// JavaScript's white space and line terminators, as `String.prototype.trim` removes them: the
/// `Zs` spaces, tab, vertical tab, form feed, the BOM, LF, CR, and U+2028, U+2029. Unlike
/// `char::is_whitespace`, NEL (U+0085) is not one and the BOM is.
fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Ports `normalizeHolderName`: `raw.trim().normalize('NFC')`, the form the Backend stores.
pub fn normalize_holder_name(raw: &str) -> String {
    raw.trim_matches(js_space).nfc().collect()
}

/// `/\p{L}/u`: a letter of any script (general category L).
static LETTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::with_flags(r"\p{L}", "u").expect("a valid pattern"));

/// Ports `holderNameProblem`: why a name is invalid, or `None` for a valid one, checked in the
/// order Missing, TooLong, ControlCharacter, NoLetter. `\p{Cc}` is `char::is_control`.
pub fn holder_name_problem(raw: &str) -> Option<HolderNameProblem> {
    let name = normalize_holder_name(raw);
    if name.is_empty() {
        return Some(HolderNameProblem::Missing);
    }
    if name.chars().count() > HOLDER_NAME_MAX {
        return Some(HolderNameProblem::TooLong);
    }
    if name.chars().any(char::is_control) {
        return Some(HolderNameProblem::ControlCharacter);
    }
    if LETTER.find(&name).is_none() {
        return Some(HolderNameProblem::NoLetter);
    }
    None
}

/// Ports `holderNameMessage`: the message the form shows and the Backend's 400 carries.
pub fn holder_name_message(p: HolderNameProblem) -> String {
    match p {
        HolderNameProblem::Missing => "Enter the name on your photo ID.".into(),
        HolderNameProblem::TooLong => {
            format!("The name can be at most {HOLDER_NAME_MAX} characters.")
        }
        HolderNameProblem::ControlCharacter => "The name can't contain tabs or line breaks.".into(),
        HolderNameProblem::NoLetter => {
            "The name on the tickets must contain at least one letter.".into()
        }
    }
}

/// The Name on tickets field: its value as typed (sent as typed; the Backend normalizes it) and
/// whether it was left once, after which an invalid name shows its message (research R2).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HolderNameField {
    value: String,
    touched: bool,
}

impl HolderNameField {
    pub fn value(&self) -> &str {
        &self.value
    }

    /// The field's `input` event.
    pub fn set(&mut self, value: impl Into<String>) {
        self.value = value.into();
    }

    /// The field's `blur` event.
    pub fn leave(&mut self) {
        self.touched = true;
    }

    /// Spec 017 FR-001: no order without a valid name.
    pub fn valid(&self) -> bool {
        holder_name_problem(&self.value).is_none()
    }

    /// Issue #182: [`NAME_NEEDED_TO_BUY`] beside a button that is usable with a valid name, while
    /// this one is not and no BUY wait shows.
    pub fn needed_to_buy(&self, usable_with_name: bool, waiting: bool) -> Option<&'static str> {
        name_needed_to_buy(self.valid(), usable_with_name, waiting)
    }

    /// The message shown under the field, once it was left.
    pub fn error(&self) -> Option<String> {
        if !self.touched {
            return None;
        }
        holder_name_problem(&self.value).map(holder_name_message)
    }

    /// `aria-invalid="true"` while a message shows.
    pub fn invalid(&self) -> bool {
        self.error().is_some()
    }

    /// The field's `aria-describedby`: the hint, and the message while it shows.
    pub fn described_by(&self) -> &'static str {
        if self.invalid() {
            "holder-name-hint holder-name-error"
        } else {
            "holder-name-hint"
        }
    }
}

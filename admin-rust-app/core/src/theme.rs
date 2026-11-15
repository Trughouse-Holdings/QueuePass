//! Spec 037 research R8, R9: the red look's checks. Reads the shared theme's two token blocks
//! (`:root` and `@media (prefers-color-scheme: dark) { :root { … } }`) and `style/red.css`, and
//! computes WCAG contrast as `packages/shared/test/theme/contrast.test.ts` does.

use std::collections::BTreeMap;

/// The 14 look tokens `red.css` redefines (research R8). Every other token, the data colors
/// first of all, stays the shared theme's.
pub const LOOK_TOKENS: [&str; 14] = [
    "bg",
    "surface",
    "surface-alt",
    "border",
    "border-strong",
    "text",
    "text-muted",
    "text-faint",
    "accent",
    "accent-hover",
    "accent-soft",
    "accent-text",
    "brand-mark-end",
    "brand-mark-text",
];

/// The color scheme a set of values is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scheme {
    Light,
    Dark,
}

/// The custom properties of a stylesheet's light (`:root`) and dark blocks, by name without `--`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThemeTokens {
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}

/// One scheme's values, the dark set falling back to the light one as the cascade does.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved(BTreeMap<String, String>);

impl Resolved {
    /// A token's value. Panics when the theme does not define it: a missing token is a bug.
    pub fn get(&self, name: &str) -> String {
        self.0
            .get(name)
            .cloned()
            .unwrap_or_else(|| panic!("--{name} is not defined"))
    }
}

impl ThemeTokens {
    /// These tokens with `over`'s loaded after them (a later stylesheet wins).
    pub fn with(&self, over: &ThemeTokens) -> ThemeTokens {
        let mut out = self.clone();
        out.light
            .extend(over.light.iter().map(|(k, v)| (k.clone(), v.clone())));
        out.dark
            .extend(over.dark.iter().map(|(k, v)| (k.clone(), v.clone())));
        out
    }

    /// The values that apply in `scheme`.
    pub fn scheme(&self, scheme: Scheme) -> Resolved {
        let mut values = self.light.clone();
        if scheme == Scheme::Dark {
            values.extend(self.dark.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
        Resolved(values)
    }
}

/// The text between the `{` at `open` and its matching `}`.
fn block_at(css: &str, open: usize) -> Option<&str> {
    let mut depth = 0usize;
    for (i, ch) in css[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&css[open + 1..open + i]);
                }
            }
            _ => {}
        }
    }
    None
}

fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        rest = match rest[start + 2..].find("*/") {
            Some(end) => &rest[start + 2 + end + 2..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

fn declarations(block: &str) -> BTreeMap<String, String> {
    block
        .split(';')
        .filter_map(|decl| {
            let (name, value) = decl.trim().split_once(':')?;
            let name = name.trim().strip_prefix("--")?;
            Some((name.to_string(), value.trim().to_string()))
        })
        .collect()
}

/// The custom properties of a stylesheet's first top-level `:root` block (light) and of the
/// `:root` block inside its `@media (prefers-color-scheme: dark)` block (dark).
pub fn parse_tokens(css: &str) -> ThemeTokens {
    let css = strip_comments(css);
    let mut tokens = ThemeTokens::default();
    let mut i = 0;
    while i < css.len() {
        let Some(open) = css[i..].find('{').map(|o| i + o) else {
            break;
        };
        let prelude = css[i..open]
            .trim()
            .rsplit(['}', ';'])
            .next()
            .unwrap_or("")
            .trim();
        let Some(body) = block_at(&css, open) else {
            break;
        };
        if prelude == ":root" && tokens.light.is_empty() {
            tokens.light = declarations(body);
        } else if prelude.starts_with("@media")
            && prelude.contains("prefers-color-scheme: dark")
            && let Some(inner) = body.find('{')
            && body[..inner].trim() == ":root"
            && let Some(dark) = block_at(body, inner)
        {
            tokens.dark = declarations(dark);
        }
        i = open + body.len() + 2;
    }
    tokens
}

/// `Ok` when the stylesheet holds only custom properties in `:root` blocks, at the top level or in
/// a `prefers-color-scheme` block: no selector rule, and no other property (research R8).
pub fn custom_properties_only(css: &str) -> Result<(), String> {
    fn check(css: &str, nested: bool) -> Result<(), String> {
        let mut i = 0;
        while i < css.len() {
            let Some(open) = css[i..].find('{').map(|o| i + o) else {
                if css[i..].trim().is_empty() {
                    return Ok(());
                }
                return Err(format!("text outside a rule: {}", css[i..].trim()));
            };
            let prelude = css[i..open].trim();
            let body = block_at(css, open).ok_or("an unclosed block")?;
            if prelude.starts_with("@media") && !nested {
                if !prelude.contains("prefers-color-scheme") {
                    return Err(format!(
                        "a media block other than the color scheme: {prelude}"
                    ));
                }
                check(body, true)?;
            } else if prelude == ":root" {
                for decl in body.split(';').map(str::trim).filter(|d| !d.is_empty()) {
                    if !decl.starts_with("--") {
                        return Err(format!(
                            "a declaration that is not a custom property: {decl}"
                        ));
                    }
                }
            } else {
                return Err(format!("a selector rule: {prelude}"));
            }
            i = open + body.len() + 2;
        }
        Ok(())
    }
    check(&strip_comments(css), false)
}

/// WCAG relative luminance of a `#rrggbb` color.
pub fn luminance(hex: &str) -> f64 {
    let hex = hex.trim().trim_start_matches('#');
    assert_eq!(hex.len(), 6, "not #rrggbb: #{hex}");
    let channel = |i: usize| {
        let c = f64::from(u8::from_str_radix(&hex[i..i + 2], 16).expect("hex digit")) / 255.0;
        if c <= 0.03928 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/// The WCAG contrast ratio of two `#rrggbb` colors, from 1 to 21.
pub fn contrast(a: &str, b: &str) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    let (hi, lo) = if la >= lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

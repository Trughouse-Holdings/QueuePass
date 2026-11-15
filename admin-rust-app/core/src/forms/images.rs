//! Spec 037 T051 (parity E4, E4b, E6): event pictures in the event form, browser-free.
//!
//! Ports `packages/shared/src/event-image.ts` (the limits, `sniffImageType`, `readImageHeader`),
//! the per-file checks, list, and preview shapes of `admin-app/src/components/ImagesField.tsx`,
//! and the picture steps of `admin-app/src/pages/EventForm.tsx` (`applyImages`, `reloadImages`,
//! `addImages`, `moveImage`, `removeImage`, `ImageStepError`). A file is anything that has a name
//! ([`ImageFile`]): the app's `web_sys::File`, a test's bytes. Loading a stored image with the
//! token (`packages/shared/src/web/event-images.ts`) is the app's: it needs the browser.

use serde::{Deserialize, Serialize};

use crate::api::client::{ApiError, StatusError};

/// Ports `ImageContentType` and `IMAGE_CONTENT_TYPES` (`event-image.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageContentType {
    Jpeg,
    Png,
    Webp,
}

impl ImageContentType {
    /// `image/jpeg`, `image/png`, or `image/webp`.
    pub fn as_str(self) -> &'static str {
        match self {
            ImageContentType::Jpeg => "image/jpeg",
            ImageContentType::Png => "image/png",
            ImageContentType::Webp => "image/webp",
        }
    }
}

/// Ports `IMAGE_CONTENT_TYPES` (`event-image.ts`): the contract's enum, in its order.
pub const IMAGE_CONTENT_TYPES: [ImageContentType; 3] = [
    ImageContentType::Jpeg,
    ImageContentType::Png,
    ImageContentType::Webp,
];

/// Ports `EVENT_IMAGE_LIMITS` (`event-image.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventImageLimits {
    pub max_count: usize,
    pub max_bytes: u64,
}

/// FR-001, FR-004: at most 5 images, each at most 5 MB (5 × 1024 × 1024 bytes).
pub const EVENT_IMAGE_LIMITS: EventImageLimits = EventImageLimits {
    max_count: 5,
    max_bytes: 5_242_880,
};

/// Ports `IMAGE_PIXEL_LIMITS` (`event-image.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImagePixelLimits {
    pub max_side: u64,
    pub max_pixels: u64,
}

/// FR-036: at most 16,384 pixels a side and 40 megapixels in all.
pub const IMAGE_PIXEL_LIMITS: ImagePixelLimits = ImagePixelLimits {
    max_side: 16_384,
    max_pixels: 40_000_000,
};

/// Ports `GALLERY_INTERVAL_MS` (`event-image.ts`): each gallery shows the next image every 5 s.
pub const GALLERY_INTERVAL_MS: u64 = 5000;

/// Ports `ImageHeader` (`event-image.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageHeader {
    pub content_type: ImageContentType,
    pub width: u64,
    pub height: u64,
    /// An APNG (`acTL` before `IDAT`) or an animated WebP; refused by FR-037.
    pub animated: bool,
}

/// Ports `EventImage` (`event-image.ts`): one picture of an event, metadata only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventImage {
    pub id: String,
    /// 1 to 5; 1 is the cover.
    pub position: u64,
    pub content_type: String,
    pub byte_size: u64,
}

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// `ascii(b, at, length)`: the bytes there, cut short at the end as `subarray` is.
fn ascii(b: &[u8], at: usize, length: usize) -> &[u8] {
    let start = at.min(b.len());
    &b[start..(at + length).min(b.len())]
}

fn byte(b: &[u8], at: usize) -> u64 {
    u64::from(b.get(at).copied().unwrap_or(0))
}

fn u16be(b: &[u8], at: usize) -> u64 {
    (byte(b, at) << 8) | byte(b, at + 1)
}

fn u32be(b: &[u8], at: usize) -> u64 {
    (byte(b, at) << 24) | (byte(b, at + 1) << 16) | (byte(b, at + 2) << 8) | byte(b, at + 3)
}

fn u24le(b: &[u8], at: usize) -> u64 {
    byte(b, at) | (byte(b, at + 1) << 8) | (byte(b, at + 2) << 16)
}

fn u32le(b: &[u8], at: usize) -> u64 {
    byte(b, at) | (byte(b, at + 1) << 8) | (byte(b, at + 2) << 16) | (byte(b, at + 3) << 24)
}

fn u16le(b: &[u8], at: usize) -> u64 {
    byte(b, at) | (byte(b, at + 1) << 8)
}

/// Ports `sniffImageType` (`event-image.ts`): the type a file's first 12 bytes show. The file
/// name and the type it was sent with are never consulted.
pub fn sniff_image_type(bytes: &[u8]) -> Option<ImageContentType> {
    if bytes.len() < 12 {
        return None;
    }
    if bytes[..3] == [0xff, 0xd8, 0xff] {
        return Some(ImageContentType::Jpeg);
    }
    if bytes[..8] == PNG_SIGNATURE {
        return Some(ImageContentType::Png);
    }
    if ascii(bytes, 0, 4) == b"RIFF" && ascii(bytes, 8, 4) == b"WEBP" {
        return Some(ImageContentType::Webp);
    }
    None
}

/// Ports `readImageHeader` (`event-image.ts`): the type, size in pixels, and whether the picture
/// is animated, from headers only; `None` when the file is not one of the three types, its header
/// is cut short, or it gives no size or a zero size. The pixel limits are the caller's decision.
pub fn read_image_header(bytes: &[u8]) -> Option<ImageHeader> {
    let content_type = sniff_image_type(bytes)?;
    let (width, height, animated) = match content_type {
        ImageContentType::Png => read_png(bytes),
        ImageContentType::Jpeg => read_jpeg(bytes),
        ImageContentType::Webp => read_webp(bytes),
    }?;
    if width == 0 || height == 0 {
        return None;
    }
    Some(ImageHeader {
        content_type,
        width,
        height,
        animated,
    })
}

type Size = Option<(u64, u64, bool)>;

fn read_png(b: &[u8]) -> Size {
    // The IHDR chunk must come first: length 13 at byte 8, its type at 12, width at 16, height at 20.
    if b.len() < 33 || ascii(b, 12, 4) != b"IHDR" || u32be(b, 8) != 13 {
        return None;
    }
    let (width, height) = (u32be(b, 16), u32be(b, 20));
    // APNG: an acTL chunk before the first IDAT.
    let mut animated = false;
    let mut at: u64 = 8;
    while at + 8 <= b.len() as u64 {
        let i = at as usize;
        let length = u32be(b, i);
        let kind = ascii(b, i + 4, 4);
        if kind == b"acTL" {
            animated = true;
            break;
        }
        if kind == b"IDAT" || kind == b"IEND" {
            break;
        }
        at += 12 + length;
    }
    Some((width, height, animated))
}

fn read_jpeg(b: &[u8]) -> Size {
    let mut at = 2;
    while at < b.len() {
        if b[at] != 0xff {
            return None;
        }
        // Fill bytes before a marker code.
        while at < b.len() && b[at] == 0xff {
            at += 1;
        }
        if at >= b.len() {
            return None;
        }
        let marker = b[at];
        at += 1;
        // Standalone markers have no length.
        if (0xd0..=0xd7).contains(&marker) || marker == 0x01 {
            continue;
        }
        if marker == 0xd9 || marker == 0xda {
            return None; // EOI or SOS before any frame header
        }
        if at + 2 > b.len() {
            return None;
        }
        let length = u16be(b, at) as usize;
        if length < 2 || at + length > b.len() {
            return None;
        }
        let is_sof =
            (0xc0..=0xcf).contains(&marker) && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
        if is_sof {
            if length < 7 {
                return None;
            }
            return Some((u16be(b, at + 5), u16be(b, at + 3), false));
        }
        at += length;
    }
    None
}

fn read_webp(b: &[u8]) -> Size {
    if b.len() < 20 {
        return None;
    }
    let end = (b.len() as u64).min(8 + u32le(b, 4));
    let first = ascii(b, 12, 4);
    let first_length = u32le(b, 16);
    let data = 20usize;
    if data as u64 + first_length > end {
        return None;
    }
    match first {
        b"VP8X" => {
            if first_length < 10 {
                return None;
            }
            let mut animated = (b[data] & 0x02) != 0;
            // Any ANIM or ANMF chunk also marks an animation.
            let mut at: u64 = 12;
            while !animated && at + 8 <= end {
                let i = at as usize;
                let kind = ascii(b, i, 4);
                if kind == b"ANIM" || kind == b"ANMF" {
                    animated = true;
                }
                let length = u32le(b, i + 4);
                at += 8 + length + (length % 2);
            }
            Some((u24le(b, data + 4) + 1, u24le(b, data + 7) + 1, animated))
        }
        b"VP8L" => {
            if first_length < 5 || b[data] != 0x2f {
                return None;
            }
            let v = u32le(b, data + 1);
            Some(((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1, false))
        }
        b"VP8 " => {
            if first_length < 10 || b[data + 3..data + 6] != [0x9d, 0x01, 0x2a] {
                return None;
            }
            Some((
                u16le(b, data + 6) & 0x3fff,
                u16le(b, data + 8) & 0x3fff,
                false,
            ))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------- ImagesField.tsx

/// `HINT` (`ImagesField.tsx`).
pub const IMAGES_HINT: &str =
    "Up to 5 images. JPG, PNG, or WebP, up to 5 MB each. The first image is the cover.";
/// The file input's `accept`.
pub const ACCEPT: &str = "image/jpeg,image/png,image/webp";
/// The file input's label.
pub const ADD_IMAGES_LABEL: &str = "Add images";

/// Shown instead of the file input once the list is full.
pub fn full_note() -> String {
    let n = EVENT_IMAGE_LIMITS.max_count;
    format!("{n} of {n} images. Remove one to add another.")
}

/// Ports `refusalOf` (`ImagesField.tsx`): why the form will not send a file of `size` bytes whose
/// content is `bytes`, or `None`. The size is checked first, before the bytes are read.
pub fn refusal_of(size: u64, bytes: &[u8]) -> Option<&'static str> {
    if size > EVENT_IMAGE_LIMITS.max_bytes {
        return Some("over 5 MB");
    }
    let Some(header) = read_image_header(bytes) else {
        return Some("only JPG, PNG, or WebP pictures");
    };
    if header.animated {
        return Some("animated pictures are not accepted");
    }
    let ImagePixelLimits {
        max_side,
        max_pixels,
    } = IMAGE_PIXEL_LIMITS;
    if header.width > max_side
        || header.height > max_side
        || header.width * header.height > max_pixels
    {
        return Some("over 16,384 pixels a side or 40 megapixels");
    }
    None
}

/// A picked file: the app's browser file, or a test's.
pub trait ImageFile: Clone {
    /// The file's name, as the notes and notices show it.
    fn name(&self) -> String;
}

/// What [`choose`] returns.
#[derive(Debug, Clone, PartialEq)]
pub struct Choice<F> {
    /// The files to add, in order.
    pub accepted: Vec<F>,
    /// "{file}: {why}" for each file left out, in order, for the polite live region.
    pub notes: Vec<String>,
}

/// Ports `choose` (`ImagesField.tsx`) after the checks: `reasons[i]` is [`refusal_of`] for
/// `files[i]`; `count` is how many items the list holds, counting files already handed over and
/// not yet added (so two quick choices never pass 5). The caller adds `accepted.len()` to its
/// count at once, and clears the input so the same file can be picked again.
pub fn choose<F: ImageFile>(files: &[F], reasons: &[Option<&str>], count: usize) -> Choice<F> {
    let mut accepted = Vec::new();
    let mut notes = Vec::new();
    let mut room = EVENT_IMAGE_LIMITS.max_count as i64 - count as i64;
    for (i, file) in files.iter().enumerate() {
        if let Some(why) = reasons.get(i).copied().flatten() {
            notes.push(format!("{}: {why}", file.name()));
        } else if room <= 0 {
            notes.push(format!(
                "{}: an event can have at most {} images",
                file.name(),
                EVENT_IMAGE_LIMITS.max_count
            ));
        } else {
            accepted.push(file.clone());
            room -= 1;
        }
    }
    Choice { accepted, notes }
}

/// "Image N", the item's name and its preview's `alt`.
pub fn image_alt(index: usize) -> String {
    format!("Image {}", index + 1)
}

/// `aria-label` of "Earlier".
pub fn move_earlier_label(index: usize) -> String {
    format!("Move image {} earlier", index + 1)
}

/// `aria-label` of "Later".
pub fn move_later_label(index: usize) -> String {
    format!("Move image {} later", index + 1)
}

/// `aria-label` of "Remove".
pub fn remove_label(index: usize) -> String {
    format!("Remove image {}", index + 1)
}

/// Which of an item's pill and buttons show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemControls {
    /// The "Cover" pill, on the first.
    pub cover: bool,
    /// "Earlier", on all but the first.
    pub earlier: bool,
    /// "Later", on all but the last.
    pub later: bool,
}

/// The pill and buttons of item `index` in a list of `len` (Remove is always there).
pub fn item_controls(index: usize, len: usize) -> ItemControls {
    ItemControls {
        cover: index == 0,
        earlier: index > 0,
        later: index + 1 < len,
    }
}

/// `ThumbImage`'s class: the 4:3 loading shape until the picture has loaded (review I7).
pub fn thumb_class(loaded: bool) -> &'static str {
    if loaded {
        "image-item__thumb"
    } else {
        "image-item__thumb image-item__thumb--loading"
    }
}

/// A preview's height over its width, as the shared stylesheet draws it (FR-041, FR-042): the
/// picture's own shape, clamped from 2:1 (0.5) to 3:4 (4/3); 4:3 (0.75) until its size is known.
pub fn preview_ratio(natural: Option<(u64, u64)>) -> f64 {
    match natural {
        Some((w, h)) if w > 0 => (h as f64 / w as f64).clamp(0.5, 4.0 / 3.0),
        _ => 0.75,
    }
}

// ---------------------------------------------------------------- the list (EventForm.tsx)

/// Ports `ImageItem` (`ImagesField.tsx`): a picture already stored, or chosen and not yet sent. A
/// picture sent from this form keeps its `file`, so its preview stays the chosen file's.
#[derive(Debug, Clone, PartialEq)]
pub enum ImageItem<F> {
    Saved {
        key: String,
        image: EventImage,
        file: Option<F>,
    },
    New {
        key: String,
        file: F,
    },
}

impl<F> ImageItem<F> {
    /// The item's list key.
    pub fn key(&self) -> &str {
        match self {
            ImageItem::Saved { key, .. } | ImageItem::New { key, .. } => key,
        }
    }

    /// The file it shows from, when it was chosen in this form.
    pub fn file(&self) -> Option<&F> {
        match self {
            ImageItem::Saved { file, .. } => file.as_ref(),
            ImageItem::New { file, .. } => Some(file),
        }
    }
}

/// The event form's pictures (`images`, `removed`, `serverOrder` of `EventForm.tsx`). Changes are
/// made on Save: delete each removed image, upload each new picture in list order, then reorder
/// only if the order differs from the Backend's.
#[derive(Debug, Clone, PartialEq)]
pub struct ImageList<F> {
    /// The pictures in order.
    pub items: Vec<ImageItem<F>>,
    /// Stored images the admin removed, deleted on Save.
    pub removed: Vec<EventImage>,
    /// The order the Backend holds, as far as the form knows.
    pub server_order: Vec<String>,
    next_key: u64,
}

impl<F> Default for ImageList<F> {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            removed: Vec::new(),
            server_order: Vec::new(),
            next_key: 0,
        }
    }
}

impl<F: ImageFile> ImageList<F> {
    fn new_item(&mut self, file: F) -> ImageItem<F> {
        self.next_key += 1;
        ImageItem::New {
            key: format!("new-{}", self.next_key),
            file,
        }
    }

    /// The edit form loaded the event: its stored images, then the pictures not yet added when it
    /// was created (handed over in router state).
    pub fn load(&mut self, stored: Vec<EventImage>, pending: Vec<F>) {
        self.server_order = stored.iter().map(|i| i.id.clone()).collect();
        self.removed.clear();
        let pending: Vec<ImageItem<F>> = pending.into_iter().map(|f| self.new_item(f)).collect();
        self.items = stored
            .into_iter()
            .map(|image| ImageItem::Saved {
                key: image.id.clone(),
                image,
                file: None,
            })
            .chain(pending)
            .collect();
    }

    /// Ports `addImages`: at most 5, checked against the latest list.
    pub fn add(&mut self, files: Vec<F>) {
        let added: Vec<ImageItem<F>> = files.into_iter().map(|f| self.new_item(f)).collect();
        self.items.extend(added);
        self.items.truncate(EVENT_IMAGE_LIMITS.max_count);
    }

    /// Whether the list holds 5 (the file input gives way to [`full_note`]).
    pub fn is_full(&self) -> bool {
        self.items.len() >= EVENT_IMAGE_LIMITS.max_count
    }

    /// Ports `moveImage`: the item at `index` one place earlier (`-1`) or later (`1`), as
    /// `splice` places it (a negative place counts from the end).
    pub fn move_item(&mut self, index: usize, by: i64) {
        if index >= self.items.len() {
            return;
        }
        let item = self.items.remove(index);
        let len = self.items.len() as i64;
        let target = index as i64 + by;
        let at = if target < 0 {
            (len + target).max(0)
        } else {
            target.min(len)
        };
        self.items.insert(at as usize, item);
    }

    /// Ports `removeImage`: a stored image is deleted on Save.
    pub fn remove(&mut self, index: usize) {
        if index >= self.items.len() {
            return;
        }
        let item = self.items.remove(index);
        if let ImageItem::Saved { image, .. } = item {
            self.removed.push(image);
        }
    }

    /// The removed stored images still to delete, in order.
    pub fn to_delete(&self) -> Vec<EventImage> {
        self.removed.clone()
    }

    /// A delete succeeded (or answered 404, see [`delete_done`]).
    pub fn deleted(&mut self, image_id: &str) {
        self.server_order.retain(|i| i != image_id);
        self.removed.retain(|r| r.id != image_id);
    }

    /// The next picture to upload, by list order: its key and file.
    pub fn next_upload(&self) -> Option<(String, F)> {
        self.items.iter().find_map(|it| match it {
            ImageItem::New { key, file } => Some((key.clone(), file.clone())),
            ImageItem::Saved { .. } => None,
        })
    }

    /// An upload succeeded: the item is stored, keeping its file.
    pub fn uploaded(&mut self, key: &str, image: EventImage) {
        self.server_order.push(image.id.clone());
        for it in &mut self.items {
            if let ImageItem::New { key: k, file } = it
                && k == key
            {
                *it = ImageItem::Saved {
                    key: key.to_string(),
                    image: image.clone(),
                    file: Some(file.clone()),
                };
                break;
            }
        }
    }

    /// The pictures not yet added, from the one whose upload failed on (`ImageStepError.remaining`).
    pub fn remaining_from(&self, key: &str) -> Vec<F> {
        let Some(at) = self.items.iter().position(|it| it.key() == key) else {
            return Vec::new();
        };
        self.items[at..]
            .iter()
            .filter_map(|it| match it {
                ImageItem::New { file, .. } => Some(file.clone()),
                ImageItem::Saved { .. } => None,
            })
            .collect()
    }

    /// The image ids in list order once every picture is uploaded; `None` while one is not.
    pub fn order_ids(&self) -> Option<Vec<String>> {
        self.items
            .iter()
            .map(|it| match it {
                ImageItem::Saved { image, .. } => Some(image.id.clone()),
                ImageItem::New { .. } => None,
            })
            .collect()
    }

    /// Whether `ids` differ from the Backend's order, so the order is sent.
    pub fn needs_reorder(&self, ids: &[String]) -> bool {
        ids.join(",") != self.server_order.join(",")
    }

    /// The reorder answered with the images in their new order.
    pub fn reordered(&mut self, ordered: Vec<EventImage>) {
        self.server_order = ordered.iter().map(|i| i.id.clone()).collect();
        for it in &mut self.items {
            if let ImageItem::Saved { image, .. } = it
                && let Some(next) = ordered.iter().find(|o| o.id == image.id)
            {
                *image = next.clone();
            }
        }
    }

    /// Ports `reloadImages` (`IMAGES_CHANGED`): the event's current images, with the pictures not
    /// yet added after them; pictures sent from this form keep showing from their files.
    pub fn reload(&mut self, stored: Vec<EventImage>) {
        self.server_order = stored.iter().map(|i| i.id.clone()).collect();
        self.removed.clear();
        let files: Vec<(String, F)> = self
            .items
            .iter()
            .filter_map(|it| match it {
                ImageItem::Saved {
                    image,
                    file: Some(f),
                    ..
                } => Some((image.id.clone(), f.clone())),
                _ => None,
            })
            .collect();
        let pending: Vec<ImageItem<F>> = self
            .items
            .drain(..)
            .filter(|it| matches!(it, ImageItem::New { .. }))
            .collect();
        self.items = stored
            .into_iter()
            .map(|image| {
                let file = files
                    .iter()
                    .find(|(id, _)| *id == image.id)
                    .map(|(_, f)| f.clone());
                ImageItem::Saved {
                    key: image.id.clone(),
                    image,
                    file,
                }
            })
            .chain(pending)
            .collect();
    }
}

/// A delete's failure that counts as done: already gone (404).
pub fn delete_done(error: &ApiError) -> bool {
    error.status() == Some(404)
}

/// The notice the edit form shows after a create whose pictures were not all added (spec 014
/// FR-018): "Event created. These pictures were not added: a.jpg (why), b.jpg. Save again to add
/// them." `refusal` is the first failed upload's refusal, `None` when it could not be sent.
pub fn pending_notice(first: &str, refusal: Option<&ApiError>, rest: &[String]) -> String {
    let why = refusal.map_or("could not be sent", ApiError::message);
    let mut names = vec![format!("{first} ({why})")];
    names.extend(rest.iter().cloned());
    format!(
        "Event created. These pictures were not added: {}. Save again to add them.",
        names.join(", ")
    )
}

/// Ports `ImageStepError.asApiError` (`EventForm.tsx`): a picture step's failure on the edit form,
/// "{file}: {message}", or "{file}: It could not be sent. Check the connection and save again."
/// It keeps the refusal's status (else 0), code (else `VALIDATION_FAILED`), and details.
pub fn image_step_error(file: &str, refusal: Option<&ApiError>) -> ApiError {
    let message = refusal.map_or(
        "It could not be sent. Check the connection and save again.",
        ApiError::message,
    );
    ApiError::Status(StatusError {
        status: refusal.and_then(ApiError::status).unwrap_or(0),
        code: refusal
            .and_then(ApiError::code)
            .unwrap_or("VALIDATION_FAILED")
            .to_string(),
        message: format!("{file}: {message}"),
        details: refusal.and_then(ApiError::details).cloned(),
        enveloped: true,
    })
}

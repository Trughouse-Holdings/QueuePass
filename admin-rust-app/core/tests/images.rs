//! Spec 037 T051 (parity E4, E4b, E6): event pictures, ported from
//! `packages/shared/src/event-image.ts` (with the cases of `packages/shared/test/event-image.test.ts`),
//! the per-file checks, list, and previews of `admin-app/src/components/ImagesField.tsx`, and the
//! picture steps of `admin-app/src/pages/EventForm.tsx` (the cases of
//! `admin-app/test/images-field.test.tsx`). Files are built byte by byte.

use admin_rust_core::api::client::{ApiError, error_from};
use admin_rust_core::forms::images::{
    self, EVENT_IMAGE_LIMITS, EventImage, GALLERY_INTERVAL_MS, IMAGE_CONTENT_TYPES,
    IMAGE_PIXEL_LIMITS, ImageContentType, ImageFile, ImageHeader, ImageItem, ImageList,
    read_image_header, refusal_of, sniff_image_type,
};
use base64::Engine;
use serde_json::json;

// ---------------------------------------------------------------- byte builders (the test's)

fn ascii(s: &str) -> Vec<u8> {
    s.bytes().collect()
}
fn u32be(n: u32) -> Vec<u8> {
    n.to_be_bytes().to_vec()
}
fn u32le(n: u32) -> Vec<u8> {
    n.to_le_bytes().to_vec()
}
fn u16be(n: u32) -> Vec<u8> {
    vec![(n >> 8) as u8, n as u8]
}
fn u24le(n: u32) -> Vec<u8> {
    vec![n as u8, (n >> 8) as u8, (n >> 16) as u8]
}
fn cat(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.concat()
}

const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

fn chunk(kind: &str, data: &[u8]) -> Vec<u8> {
    cat(&[
        u32be(data.len() as u32),
        ascii(kind),
        data.to_vec(),
        vec![0; 4],
    ])
}
fn ihdr(w: u32, h: u32) -> Vec<u8> {
    chunk("IHDR", &cat(&[u32be(w), u32be(h), vec![8, 2, 0, 0, 0]]))
}
fn png(w: u32, h: u32, extra: &[Vec<u8>]) -> Vec<u8> {
    let mut parts = vec![PNG_SIG.to_vec(), ihdr(w, h)];
    parts.extend(extra.iter().cloned());
    parts.push(chunk("IDAT", &[1, 2, 3]));
    parts.push(chunk("IEND", &[]));
    cat(&parts)
}

fn seg(marker: u8, payload: &[u8]) -> Vec<u8> {
    cat(&[
        vec![0xff, marker],
        u16be(payload.len() as u32 + 2),
        payload.to_vec(),
    ])
}
fn sof(marker: u8, w: u32, h: u32) -> Vec<u8> {
    seg(
        marker,
        &cat(&[
            vec![8],
            u16be(h),
            u16be(w),
            vec![3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
        ]),
    )
}
fn jpeg(segments: &[Vec<u8>]) -> Vec<u8> {
    let mut parts = vec![vec![0xff, 0xd8]];
    parts.extend(segments.iter().cloned());
    parts.push(seg(0xda, &[1, 1, 0, 0, 0x3f, 0]));
    parts.push(vec![1, 2, 3, 0xff, 0xd9]);
    cat(&parts)
}
fn exif_app1() -> Vec<u8> {
    seg(
        0xe1,
        &cat(&[
            ascii("Exif\0\0"),
            vec![0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0],
        ]),
    )
}

fn riff(chunks: &[Vec<u8>]) -> Vec<u8> {
    let mut body = ascii("WEBP");
    for c in chunks {
        body.extend(c);
    }
    cat(&[ascii("RIFF"), u32le(body.len() as u32), body])
}
fn wchunk(kind: &str, data: &[u8]) -> Vec<u8> {
    let pad = if data.len() % 2 == 1 { vec![0] } else { vec![] };
    cat(&[ascii(kind), u32le(data.len() as u32), data.to_vec(), pad])
}
fn vp8x(flags: u8, w: u32, h: u32) -> Vec<u8> {
    wchunk(
        "VP8X",
        &cat(&[vec![flags, 0, 0, 0], u24le(w - 1), u24le(h - 1)]),
    )
}
fn vp8l(w: u32, h: u32) -> Vec<u8> {
    let v = (w - 1) | ((h - 1) << 14);
    wchunk("VP8L", &cat(&[vec![0x2f], u32le(v), vec![0, 0]]))
}
fn vp8(w: u32, h: u32) -> Vec<u8> {
    wchunk(
        "VP8 ",
        &[
            0x10,
            0x02,
            0x00,
            0x9d,
            0x01,
            0x2a,
            w as u8,
            (w >> 8) as u8,
            h as u8,
            (h >> 8) as u8,
            0,
            0,
        ],
    )
}

fn header(t: ImageContentType, width: u64, height: u64, animated: bool) -> ImageHeader {
    ImageHeader {
        content_type: t,
        width,
        height,
        animated,
    }
}

const TINY_WEBP: &str = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

fn tiny_webp() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(TINY_WEBP)
        .unwrap()
}

// ---------------------------------------------------------------- event-image.test.ts

#[test]
fn constants_match_the_contract_and_the_spec() {
    assert_eq!(IMAGE_PIXEL_LIMITS.max_side, 16384);
    assert_eq!(IMAGE_PIXEL_LIMITS.max_pixels, 40_000_000);
    assert_eq!(EVENT_IMAGE_LIMITS.max_count, 5);
    assert_eq!(EVENT_IMAGE_LIMITS.max_bytes, 5_242_880);
    assert_eq!(
        IMAGE_CONTENT_TYPES.map(ImageContentType::as_str),
        ["image/jpeg", "image/png", "image/webp"]
    );
    assert_eq!(GALLERY_INTERVAL_MS, 5000);
}

#[test]
fn sniff_recognizes_the_three_signatures() {
    let jpeg_head = cat(&[vec![0xff, 0xd8, 0xff, 0xe0], vec![0; 8]]);
    assert_eq!(sniff_image_type(&jpeg_head), Some(ImageContentType::Jpeg));
    assert_eq!(
        sniff_image_type(&cat(&[PNG_SIG.to_vec(), vec![0, 0, 0, 13]])),
        Some(ImageContentType::Png)
    );
    assert_eq!(
        sniff_image_type(&cat(&[ascii("RIFF"), vec![1, 2, 3, 4], ascii("WEBP")])),
        Some(ImageContentType::Webp)
    );
}

#[test]
fn sniff_refuses_everything_else() {
    assert_eq!(
        sniff_image_type(&cat(&[ascii("GIF89a"), vec![1, 0, 1, 0, 0, 0]])),
        None
    );
    assert_eq!(
        sniff_image_type(&ascii("<svg xmlns=\"http://www.w3.org/2000/svg\">")),
        None
    );
    assert_eq!(
        sniff_image_type(&cat(&[ascii("RIFF"), vec![1, 2, 3, 4], ascii("WAVE")])),
        None
    );
    assert_eq!(sniff_image_type(&ascii("%PDF-1.7\n%abc")), None);
    assert_eq!(sniff_image_type(&[]), None);
    assert_eq!(sniff_image_type(&[0xff, 0xd8]), None);
}

#[test]
fn sniff_needs_12_bytes() {
    assert_eq!(
        sniff_image_type(&cat(&[PNG_SIG.to_vec(), vec![0, 0, 0]])),
        None
    );
    assert_eq!(
        sniff_image_type(&cat(&[PNG_SIG.to_vec(), vec![0, 0, 0, 0]])),
        Some(ImageContentType::Png)
    );
}

#[test]
fn reads_a_png() {
    assert_eq!(
        read_image_header(&png(640, 480, &[])),
        Some(header(ImageContentType::Png, 640, 480, false))
    );
}

#[test]
fn reads_a_jpeg_with_an_exif_app1_before_sof0() {
    assert_eq!(
        read_image_header(&jpeg(&[exif_app1(), sof(0xc0, 1024, 768)])),
        Some(header(ImageContentType::Jpeg, 1024, 768, false))
    );
}

#[test]
fn reads_a_progressive_jpeg_skipping_dht() {
    let dht = seg(0xc4, &cat(&[vec![0], vec![0; 16]]));
    let h = read_image_header(&jpeg(&[dht, sof(0xc2, 300, 200)])).unwrap();
    assert_eq!(
        (h.content_type, h.width, h.height),
        (ImageContentType::Jpeg, 300, 200)
    );
}

#[test]
fn jpeg_fill_bytes_and_standalone_markers_are_skipped() {
    let bytes = cat(&[
        vec![0xff, 0xd8, 0xff, 0xff, 0xd0, 0xff, 0x01],
        sof(0xc1, 7, 9),
    ]);
    assert_eq!(
        read_image_header(&bytes),
        Some(header(ImageContentType::Jpeg, 7, 9, false))
    );
    // Not a marker where one should be; fill bytes to the end; EOI first; a short SOF.
    assert_eq!(
        read_image_header(&cat(&[
            vec![0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 1],
            vec![0; 4]
        ])),
        None
    );
    assert_eq!(
        read_image_header(&cat(&[vec![0xff, 0xd8], vec![0xff; 10]])),
        None
    );
    assert_eq!(
        read_image_header(&cat(&[vec![0xff, 0xd8, 0xff, 0xd9], vec![0; 8]])),
        None
    );
    assert_eq!(
        read_image_header(&cat(&[
            vec![0xff, 0xd8, 0xff, 0xc0, 0, 6, 8, 0, 1, 0],
            vec![0; 4]
        ])),
        None
    );
    // A length below 2, and a marker with no room for its length.
    assert_eq!(
        read_image_header(&cat(&[vec![0xff, 0xd8, 0xff, 0xe0, 0, 1], vec![0; 6]])),
        None
    );
    assert_eq!(
        read_image_header(&cat(&[
            vec![0xff, 0xd8, 0xff, 0xe0, 0, 6, 0, 0, 0, 0],
            vec![0xff, 0xe0]
        ])),
        None
    );
}

#[test]
fn reads_webp_vp8_vp8l_and_vp8x() {
    assert_eq!(
        read_image_header(&riff(&[vp8(320, 240)])),
        Some(header(ImageContentType::Webp, 320, 240, false))
    );
    assert_eq!(
        read_image_header(&riff(&[vp8l(1, 1)])),
        Some(header(ImageContentType::Webp, 1, 1, false))
    );
    let big = read_image_header(&riff(&[vp8l(16384, 2)])).unwrap();
    assert_eq!((big.width, big.height), (16384, 2));
    assert_eq!(
        read_image_header(&riff(&[vp8x(0, 5000, 3000), vp8(5000 & 0x3fff, 3000)])),
        Some(header(ImageContentType::Webp, 5000, 3000, false))
    );
}

#[test]
fn webp_cut_short_or_malformed_is_refused() {
    // Under 20 bytes; a first chunk past the end; short chunks; a bad VP8L or VP8 signature.
    assert_eq!(
        read_image_header(&cat(&[ascii("RIFF"), u32le(8), ascii("WEBPVP8 ")])),
        None
    );
    let mut long = riff(&[vp8(320, 240)]);
    long.truncate(25);
    assert_eq!(read_image_header(&long), None);
    assert_eq!(read_image_header(&riff(&[wchunk("VP8X", &[0; 8])])), None);
    assert_eq!(
        read_image_header(&riff(&[wchunk("VP8L", &[0x2f, 0, 0])])),
        None
    );
    assert_eq!(
        read_image_header(&riff(&[wchunk("VP8L", &[0x2e, 0, 0, 0, 0])])),
        None
    );
    assert_eq!(read_image_header(&riff(&[wchunk("VP8 ", &[0; 8])])), None);
    assert_eq!(read_image_header(&riff(&[wchunk("VP8 ", &[0; 10])])), None);
    assert_eq!(read_image_header(&riff(&[wchunk("ALPH", &[0; 10])])), None);
}

#[test]
fn reads_the_one_pixel_webp_of_the_quickstart() {
    assert_eq!(
        read_image_header(&tiny_webp()),
        Some(header(ImageContentType::Webp, 1, 1, false))
    );
}

#[test]
fn reports_sizes_above_the_pixel_limits_without_refusing_them() {
    let h = read_image_header(&png(20000, 20000, &[])).unwrap();
    assert_eq!((h.width, h.height), (20000, 20000));
}

#[test]
fn reports_an_animated_png() {
    let h = read_image_header(&png(10, 10, &[chunk("acTL", &[0, 0, 0, 2, 0, 0, 0, 0])])).unwrap();
    assert_eq!(h.content_type, ImageContentType::Png);
    assert!(h.animated);
}

#[test]
fn reports_an_animated_webp() {
    assert!(
        read_image_header(&riff(&[vp8x(0x02, 10, 10)]))
            .unwrap()
            .animated
    );
    assert!(
        read_image_header(&riff(&[vp8x(0, 10, 10), wchunk("ANIM", &[0; 6])]))
            .unwrap()
            .animated
    );
}

#[test]
fn refuses_unreadable_headers() {
    let not_first = cat(&[
        PNG_SIG.to_vec(),
        chunk("tEXt", &[1, 2, 3]),
        ihdr(10, 10),
        chunk("IEND", &[]),
    ]);
    assert_eq!(read_image_header(&not_first), None);
    assert_eq!(read_image_header(&jpeg(&[exif_app1()])), None);
    assert_eq!(
        read_image_header(&[0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 1, 2, 3]),
        None
    );
    assert_eq!(read_image_header(&png(10, 10, &[])[..20]), None);
    assert_eq!(read_image_header(&png(0, 10, &[])), None);
    assert_eq!(read_image_header(&jpeg(&[sof(0xc0, 0, 10)])), None);
    assert_eq!(
        read_image_header(&cat(&[ascii("GIF89a"), vec![1, 0, 1, 0, 0, 0]])),
        None
    );
}

// ---------------------------------------------------------------- ImagesField.tsx

/// `pngBytes` of `admin-app/test/helpers/images.ts`.
fn png_bytes(width: u32, height: u32, before: &[Vec<u8>], size: Option<usize>) -> Vec<u8> {
    let mut head = cat(&[PNG_SIG.to_vec(), ihdr(width, height)]);
    for b in before {
        head.extend(b);
    }
    head.extend(chunk("IDAT", &[1, 2, 3]));
    let end = chunk("IEND", &[]);
    let total = size.unwrap_or(head.len() + end.len());
    let mut bytes = vec![0u8; total];
    bytes[..head.len()].copy_from_slice(&head);
    if size.is_some() {
        let fill = (total - head.len() - end.len() - 12) as u32;
        let marker = cat(&[u32be(fill), ascii("prVt")]);
        bytes[head.len()..head.len() + 8].copy_from_slice(&marker);
    }
    let at = total - end.len();
    bytes[at..].copy_from_slice(&end);
    bytes
}

fn jpeg_bytes() -> Vec<u8> {
    vec![
        0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
        0xff, 0xd9,
    ]
}

fn gif_bytes() -> Vec<u8> {
    ascii("GIF89a\x01\x00\x01\x00\x00\x00")
}

fn animated_chunk() -> Vec<u8> {
    chunk("acTL", &[0, 0, 0, 2, 0, 0, 0, 0])
}

#[derive(Debug, Clone, PartialEq)]
struct File {
    name: String,
    bytes: Vec<u8>,
}

impl ImageFile for File {
    fn name(&self) -> String {
        self.name.clone()
    }
}

fn file(name: &str, bytes: Vec<u8>) -> File {
    File {
        name: name.into(),
        bytes,
    }
}

fn png_file(name: &str) -> File {
    file(name, png_bytes(2, 2, &[], None))
}

fn refusal(f: &File) -> Option<&'static str> {
    refusal_of(f.bytes.len() as u64, &f.bytes)
}

#[test]
fn refuses_files_before_sending_naming_each_with_its_reason() {
    let files = [
        file("anim.gif", gif_bytes()),
        file("fake.jpg", ascii("not a picture, honestly\n")),
        file("big.png", png_bytes(2, 2, &[], Some(5_242_881))),
        file("huge.png", png_bytes(20_000, 20_000, &[], None)),
        file("moving.png", png_bytes(2, 2, &[animated_chunk()], None)),
    ];
    let reasons: Vec<_> = files.iter().map(refusal).collect();
    let choice = images::choose(&files, &reasons, 0);
    assert!(choice.accepted.is_empty());
    assert_eq!(
        choice.notes,
        vec![
            "anim.gif: only JPG, PNG, or WebP pictures",
            "fake.jpg: only JPG, PNG, or WebP pictures",
            "big.png: over 5 MB",
            "huge.png: over 16,384 pixels a side or 40 megapixels",
            "moving.png: animated pictures are not accepted",
        ]
    );
}

#[test]
fn the_size_is_checked_first_and_the_pixel_limits_both_ways() {
    // Over 5 MB wins even when the bytes are no picture.
    assert_eq!(refusal_of(5_242_881, &gif_bytes()), Some("over 5 MB"));
    assert_eq!(
        refusal_of(5_242_880, &png_bytes(2, 2, &[], Some(5_242_880))),
        None
    );
    assert_eq!(refusal(&file("j.jpg", jpeg_bytes())), None);
    assert_eq!(refusal(&file("w.webp", tiny_webp())), None);
    let tall = png_bytes(2, 16_385, &[], None);
    assert_eq!(
        refusal_of(tall.len() as u64, &tall),
        Some("over 16,384 pixels a side or 40 megapixels")
    );
    let side = png_bytes(16_384, 2, &[], None);
    assert_eq!(refusal_of(side.len() as u64, &side), None);
    let many = png_bytes(8000, 5001, &[], None);
    assert_eq!(
        refusal_of(many.len() as u64, &many),
        Some("over 16,384 pixels a side or 40 megapixels")
    );
    let exact = png_bytes(8000, 5000, &[], None);
    assert_eq!(refusal_of(exact.len() as u64, &exact), None);
}

#[test]
fn a_picture_whose_later_chunk_runs_past_the_end_gets_through() {
    // `brokenPngFile`: the Backend refuses it on save (415), not the form.
    let broken = cat(&[
        png_bytes(2, 2, &[], None)[..33].to_vec(),
        u32be(99),
        ascii("IDAT"),
    ]);
    assert_eq!(refusal_of(broken.len() as u64, &broken), None);
}

#[test]
fn accepts_exactly_5_mb_and_leaves_a_sixth_out() {
    let files = [
        file("exact.png", png_bytes(2, 2, &[], Some(5_242_880))),
        png_file("b.png"),
        png_file("c.png"),
        png_file("d.png"),
        png_file("e.png"),
        png_file("sixth.png"),
    ];
    let reasons: Vec<_> = files.iter().map(refusal).collect();
    let choice = images::choose(&files, &reasons, 0);
    assert_eq!(choice.accepted.len(), 5);
    assert_eq!(
        choice.notes,
        vec!["sixth.png: an event can have at most 5 images"]
    );
    let mut list: ImageList<File> = ImageList::default();
    list.add(choice.accepted);
    assert!(list.is_full());
    assert_eq!(
        images::full_note(),
        "5 of 5 images. Remove one to add another."
    );
}

#[test]
fn keeps_to_5_when_a_second_choice_comes_before_the_first_is_added() {
    let mut list: ImageList<File> = ImageList::default();
    list.add(vec![
        png_file("a.png"),
        png_file("b.png"),
        png_file("c.png"),
    ]);
    // Both choices are checked against the count, which the first claims at once.
    let mut count = list.items.len();
    let first = [png_file("d.png"), png_file("e.png")];
    let c1 = images::choose(&first, &[None, None], count);
    count += c1.accepted.len();
    let second = [png_file("f.png"), png_file("g.png")];
    let c2 = images::choose(&second, &[None, None], count);
    assert!(c2.accepted.is_empty());
    assert_eq!(
        c2.notes,
        vec![
            "f.png: an event can have at most 5 images",
            "g.png: an event can have at most 5 images",
        ]
    );
    list.add(c1.accepted);
    list.add(c2.accepted);
    assert_eq!(list.items.len(), 5);
    // `addImages` also keeps the list itself to 5.
    list.add(vec![png_file("h.png")]);
    assert_eq!(list.items.len(), 5);
}

#[test]
fn two_files_of_one_name_each_get_a_note() {
    let files = [
        file("IMG_0001.gif", gif_bytes()),
        file("IMG_0001.gif", gif_bytes()),
    ];
    let reasons: Vec<_> = files.iter().map(refusal).collect();
    assert_eq!(images::choose(&files, &reasons, 0).notes.len(), 2);
}

#[test]
fn the_control_texts_match_the_react_app() {
    assert_eq!(
        images::IMAGES_HINT,
        "Up to 5 images. JPG, PNG, or WebP, up to 5 MB each. The first image is the cover."
    );
    assert_eq!(images::ACCEPT, "image/jpeg,image/png,image/webp");
    assert_eq!(images::image_alt(0), "Image 1");
    assert_eq!(images::move_earlier_label(1), "Move image 2 earlier");
    assert_eq!(images::move_later_label(0), "Move image 1 later");
    assert_eq!(images::remove_label(2), "Remove image 3");
}

#[test]
fn each_item_offers_earlier_later_remove_and_the_first_is_the_cover() {
    let controls: Vec<_> = (0..3).map(|i| images::item_controls(i, 3)).collect();
    assert_eq!(
        controls
            .iter()
            .map(|c| (c.cover, c.earlier, c.later))
            .collect::<Vec<_>>(),
        vec![
            (true, false, true),
            (false, true, true),
            (false, true, false)
        ]
    );
}

#[test]
fn previews_keep_the_pictures_shape_clamped_and_4_3_while_loading() {
    assert_eq!(
        images::thumb_class(false),
        "image-item__thumb image-item__thumb--loading"
    );
    assert_eq!(images::thumb_class(true), "image-item__thumb");
    // Height over width.
    assert_eq!(images::preview_ratio(None), 0.75);
    assert_eq!(images::preview_ratio(Some((640, 480))), 0.75);
    assert_eq!(images::preview_ratio(Some((400, 400))), 1.0);
    assert_eq!(images::preview_ratio(Some((1000, 100))), 0.5);
    assert_eq!(images::preview_ratio(Some((100, 1000))), 4.0 / 3.0);
    assert_eq!(images::preview_ratio(Some((0, 10))), 0.75);
}

fn saved(id: &str, position: u64) -> EventImage {
    serde_json::from_value(json!({
        "id": id,
        "position": position,
        "contentType": "image/png",
        "byteSize": 100 + position,
    }))
    .unwrap()
}

fn keys_of(list: &ImageList<File>) -> Vec<String> {
    list.items
        .iter()
        .map(|i| match i {
            ImageItem::Saved { image, .. } => image.id.clone(),
            ImageItem::New { file, .. } => file.name.clone(),
        })
        .collect()
}

#[test]
fn moves_and_removes_in_the_list() {
    let mut list: ImageList<File> = ImageList::default();
    list.add(vec![png_file("a"), png_file("b"), png_file("c")]);
    list.move_item(2, -1);
    assert_eq!(keys_of(&list), ["a", "c", "b"]);
    list.move_item(1, -1);
    assert_eq!(keys_of(&list), ["c", "a", "b"]);
    list.move_item(0, 1);
    assert_eq!(keys_of(&list), ["a", "c", "b"]);
    list.remove(0);
    assert_eq!(keys_of(&list), ["c", "b"]);
    list.remove(9);
    assert_eq!(keys_of(&list), ["c", "b"]);
    // `splice` with a negative start counts from the end (never offered: no Earlier on image 1).
    list.move_item(0, -1);
    assert_eq!(keys_of(&list), ["c", "b"]);
    assert!(list.removed.is_empty());
}

#[test]
fn deletes_image_2_then_sends_the_new_order_with_image_4_first() {
    let mut list: ImageList<File> = ImageList::default();
    list.load(
        vec![
            saved("s1", 1),
            saved("s2", 2),
            saved("s3", 3),
            saved("s4", 4),
        ],
        vec![],
    );
    list.remove(1);
    list.move_item(2, -1);
    assert_eq!(keys_of(&list), ["s1", "s4", "s3"]);
    list.move_item(1, -1);
    assert_eq!(keys_of(&list), ["s4", "s1", "s3"]);
    assert_eq!(list.to_delete(), vec![saved("s2", 2)]);
    list.deleted("s2");
    assert!(list.to_delete().is_empty());
    assert_eq!(list.server_order, ["s1", "s3", "s4"]);
    assert!(list.next_upload().is_none());
    let ids = list.order_ids().unwrap();
    assert_eq!(ids, ["s4", "s1", "s3"]);
    assert!(list.needs_reorder(&ids));
    list.reordered(vec![saved("s4", 1), saved("s1", 2), saved("s3", 3)]);
    assert_eq!(list.server_order, ["s4", "s1", "s3"]);
    match &list.items[0] {
        ImageItem::Saved { image, .. } => assert_eq!(image.position, 1),
        ImageItem::New { .. } => panic!("saved"),
    }
}

#[test]
fn no_image_request_when_nothing_changed() {
    let mut list: ImageList<File> = ImageList::default();
    list.load(vec![saved("s1", 1), saved("s2", 2)], vec![]);
    assert!(list.to_delete().is_empty());
    assert!(list.next_upload().is_none());
    assert!(!list.needs_reorder(&list.order_ids().unwrap()));
}

#[test]
fn removes_one_of_five_and_adds_one_last_no_reorder_or_first_then_reorder() {
    for (first, reorder) in [(false, false), (true, true)] {
        let mut list: ImageList<File> = ImageList::default();
        list.load(
            (1..=5).map(|n| saved(&format!("s{n}"), n)).collect(),
            vec![],
        );
        list.remove(1);
        list.add(vec![png_file("new.png")]);
        if first {
            for i in (1..5).rev() {
                list.move_item(i, -1);
            }
        }
        list.deleted("s2");
        let (key, f) = list.next_upload().unwrap();
        assert_eq!(f.name, "new.png");
        list.uploaded(&key, saved("img-1", 5));
        assert!(list.next_upload().is_none());
        // The file stays with it: its preview is not read back.
        assert!(matches!(
            list.items.iter().find(|i| i.key() == key),
            Some(ImageItem::Saved { file: Some(_), .. })
        ));
        let ids = list.order_ids().unwrap();
        assert_eq!(list.needs_reorder(&ids), reorder);
    }
}

#[test]
fn reload_keeps_pending_pictures_after_the_stored_ones() {
    let mut list: ImageList<File> = ImageList::default();
    list.load(
        vec![saved("s1", 1), saved("s2", 2)],
        vec![png_file("pending.png")],
    );
    assert_eq!(keys_of(&list), ["s1", "s2", "pending.png"]);
    list.add(vec![png_file("sent.png")]);
    let (key, _) = list.next_upload().unwrap();
    assert_eq!(list.items[2].key(), key);
    list.uploaded(&key, saved("img-1", 3));
    list.remove(1);
    list.reload(vec![
        saved("s1", 1),
        saved("s2", 2),
        saved("img-1", 3),
        saved("s4", 4),
    ]);
    assert_eq!(keys_of(&list), ["s1", "s2", "img-1", "s4", "sent.png"]);
    assert!(list.removed.is_empty());
    assert_eq!(list.server_order, ["s1", "s2", "img-1", "s4"]);
    // The one sent from this form keeps showing from its file.
    assert!(
        matches!(&list.items[2], ImageItem::Saved { file: Some(f), .. } if f.name == "pending.png")
    );
}

#[test]
fn the_remaining_files_from_a_failed_upload_on() {
    let mut list: ImageList<File> = ImageList::default();
    list.add(vec![
        png_file("a.png"),
        png_file("b.png"),
        png_file("c.png"),
    ]);
    let (a, _) = list.next_upload().unwrap();
    list.uploaded(&a, saved("img-1", 1));
    let (b, _) = list.next_upload().unwrap();
    let left: Vec<String> = list
        .remaining_from(&b)
        .iter()
        .map(|f| f.name.clone())
        .collect();
    assert_eq!(left, ["b.png", "c.png"]);
    assert!(list.remaining_from("nope").is_empty());
}

#[test]
fn notices_and_step_messages_read_as_the_react_app_has_them() {
    let type_message = "This file is not a JPG, PNG, or WebP picture.";
    let refused = ApiError::Status(error_from(
        415,
        json!({ "error": { "code": "IMAGE_TYPE_NOT_ALLOWED", "message": type_message } })
            .to_string()
            .as_bytes(),
    ));
    assert_eq!(
        images::pending_notice("b.png", Some(&refused), &["c.png".to_string()]),
        format!(
            "Event created. These pictures were not added: b.png ({type_message}), c.png. Save again to add them."
        )
    );
    assert_eq!(
        images::pending_notice("b.png", None, &["c.png".to_string()]),
        "Event created. These pictures were not added: b.png (could not be sent), c.png. Save again to add them."
    );
    let err = images::image_step_error("broken.png", Some(&refused));
    assert_eq!(err.message(), format!("broken.png: {type_message}"));
    assert_eq!(err.code(), Some("IMAGE_TYPE_NOT_ALLOWED"));
    assert_eq!(err.status(), Some(415));
    let lost = images::image_step_error("new.png", None);
    assert_eq!(
        lost.message(),
        "new.png: It could not be sent. Check the connection and save again."
    );
    assert_eq!(
        (lost.status(), lost.code()),
        (Some(0), Some("VALIDATION_FAILED"))
    );
    // A delete answered 404 is done.
    assert!(images::delete_done(&ApiError::Status(error_from(
        404, b"{}"
    ))));
    assert!(!images::delete_done(&refused));
    assert!(!images::delete_done(&ApiError::Unreachable));
}

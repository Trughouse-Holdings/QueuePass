//! Spec 037: small helpers the views use, each a port of a shared TypeScript function.

use admin_rust_core::format::maps_url;

#[test]
fn maps_url_encodes_the_address_as_encode_uri_component() {
    assert_eq!(
        maps_url("1 Arena Plaza, Louisville, KY 40202"),
        "https://www.google.com/maps/search/?api=1&query=1%20Arena%20Plaza%2C%20Louisville%2C%20KY%2040202"
    );
    assert_eq!(
        maps_url("Café & Bar #2 (rear)!*'~"),
        "https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar%20%232%20(rear)!*'~"
    );
}

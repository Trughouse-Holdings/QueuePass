//! The REST API: generated types (research R5), the client, and the seat stream (spec 015).

#[allow(clippy::all, clippy::pedantic, dead_code, missing_docs, unused_imports)]
pub mod types {
    include!(concat!(env!("OUT_DIR"), "/api_types.rs"));
}

pub mod client;
pub mod seat_stream;

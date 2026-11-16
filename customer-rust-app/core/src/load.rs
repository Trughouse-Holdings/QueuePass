//! Parity S3, S8 (`customer-app/src/use-load.ts`): what a page shows for one load of its data.
//! 2xx → shown; 401 → back through sign-in (the client has already started it, so the page keeps
//! loading); 404 → the page's "no longer available" text; anything else or no answer →
//! "Can't reach the QueuePass service.".

use crate::api::client::ApiError;

/// One page load's state.
#[derive(Clone, Debug, PartialEq)]
pub enum Load<T> {
    Loading,
    Ok(T),
    Missing,
    Unreachable,
}

impl<T> Load<T> {
    /// The state a finished load leaves.
    pub fn from_result(result: Result<T, ApiError>) -> Load<T> {
        match result {
            Ok(data) => Load::Ok(data),
            Err(e) => match e.status() {
                Some(401) => Load::Loading,
                Some(404) => Load::Missing,
                _ => Load::Unreachable,
            },
        }
    }

    /// The data, when loaded.
    pub fn ok(&self) -> Option<&T> {
        match self {
            Load::Ok(data) => Some(data),
            _ => None,
        }
    }
}

//! Parity S3, S8: `useLoad`'s four outcomes (`customer-app/src/use-load.ts`).

use customer_rust_core::{
    api::client::{ApiError, StatusError},
    load::Load,
};

fn status(code: u16) -> ApiError {
    ApiError::Status(StatusError {
        status: code,
        code: "X".into(),
        message: "x".into(),
        details: None,
        enveloped: true,
    })
}

#[test]
fn each_answer_becomes_its_page_state() {
    assert_eq!(Load::from_result(Ok::<_, ApiError>(3)), Load::Ok(3));
    assert_eq!(Load::<u8>::from_result(Err(status(401))), Load::Loading);
    assert_eq!(Load::<u8>::from_result(Err(status(404))), Load::Missing);
    assert_eq!(Load::<u8>::from_result(Err(status(500))), Load::Unreachable);
    assert_eq!(Load::<u8>::from_result(Err(status(403))), Load::Unreachable);
    assert_eq!(
        Load::<u8>::from_result(Err(ApiError::Unreachable)),
        Load::Unreachable
    );
    assert_eq!(Load::Ok(4).ok(), Some(&4));
    assert_eq!(Load::<u8>::Missing.ok(), None);
}

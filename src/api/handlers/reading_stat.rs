use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::api::auth::AuthContext;
use crate::api::AppState;
use crate::error::error::{ApiResponse, AppError};
use crate::model::reading_session::{
    BookReadingStatItem, ReadingStatsSummaryResponse, RecordReadingHeartbeatRequest,
};

#[derive(Debug, Deserialize, Default)]
pub struct ReadingSummaryQuery {
    pub today: Option<String>,
    pub book_url: Option<String>,
}

pub async fn record_reading_heartbeat(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<RecordReadingHeartbeatRequest>,
) -> Result<Json<ApiResponse<Value>>, AppError> {
    let user_ns = resolve_user_ns(
        &state,
        auth.access_token(),
        auth.secure_key(),
        auth.user_ns(),
    )
    .await?;

    state.reading_stat_service.record_heartbeat(&user_ns, req).await?;
    Ok(Json(ApiResponse::ok(Value::String("ok".to_string()))))
}

pub async fn get_reading_summary(
    State(state): State<AppState>,
    auth: AuthContext,
    Query(q): Query<ReadingSummaryQuery>,
) -> Result<Json<ApiResponse<ReadingStatsSummaryResponse>>, AppError> {
    let user_ns = resolve_user_ns(
        &state,
        auth.access_token(),
        auth.secure_key(),
        auth.user_ns(),
    )
    .await?;

    let res = state
        .reading_stat_service
        .get_summary(&user_ns, q.today.as_deref(), q.book_url.as_deref())
        .await?;
    Ok(Json(ApiResponse::ok(res)))
}

pub async fn get_reading_book_stats(
    State(state): State<AppState>,
    auth: AuthContext,
) -> Result<Json<ApiResponse<Vec<BookReadingStatItem>>>, AppError> {
    let user_ns = resolve_user_ns(
        &state,
        auth.access_token(),
        auth.secure_key(),
        auth.user_ns(),
    )
    .await?;

    let res = state.reading_stat_service.get_book_stats(&user_ns).await?;
    Ok(Json(ApiResponse::ok(res)))
}

async fn resolve_user_ns(
    state: &AppState,
    access_token: Option<&str>,
    secure_key: Option<&str>,
    user_ns: Option<&str>,
) -> Result<String, AppError> {
    match state
        .user_service
        .resolve_user_ns_with_override(access_token, secure_key, user_ns)
        .await
    {
        Ok(ns) => Ok(ns),
        Err(_) => Err(AppError::BadRequest("NEED_LOGIN".to_string())),
    }
}


use axum::{extract::State, Json};
use serde_json::Value;

use crate::{
    api::{
        auth::AuthContext,
        AppState,
    },
    error::error::{AppError, ApiResponse},
};

pub async fn get_speech_config(
    State(state): State<AppState>,
    auth: AuthContext,
) -> Result<Json<ApiResponse<Option<Value>>>, AppError> {
    let user_ns = auth.user_ns.as_deref().unwrap_or("");
    let value = state.json_document_service
        .get_value(user_ns, "speechConfig.json")
        .await?;
    Ok(Json(ApiResponse::ok(value)))
}

pub async fn save_speech_config(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<Value>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let user_ns = auth.user_ns.as_deref().unwrap_or("");
    state.json_document_service
        .set_value(user_ns, "speechConfig.json", &req)
        .await?;
    Ok(Json(ApiResponse::ok(())))
}

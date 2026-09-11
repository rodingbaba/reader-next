use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ReadingSessionRecord {
    pub id: i64,
    pub user_ns: String,
    pub book_url: String,
    pub book_name: String,
    pub author: String,
    pub cover_url: Option<String>,
    pub read_date: String,
    pub duration_secs: i64,
    pub listen_secs: i64,
    pub chapters_read: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RecordReadingHeartbeatRequest {
    pub book_url: String,
    pub book_name: String,
    pub author: Option<String>,
    pub cover_url: Option<String>,
    pub read_date: Option<String>,
    pub duration_secs: i64,
    pub is_listening: Option<bool>,
    pub chapters_delta: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DailyReadingStatItem {
    pub read_date: String,
    pub duration_secs: i64,
    pub listen_secs: i64,
    pub book_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct BookReadingStatItem {
    pub book_url: String,
    pub book_name: String,
    pub author: String,
    pub cover_url: Option<String>,
    pub total_duration_secs: i64,
    pub total_listen_secs: i64,
    pub first_read_date: String,
    pub last_read_date: String,
    pub last_read_time: Option<String>,
    pub total_days: i64,
    pub total_chapters_read: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ReadingStatsSummaryResponse {
    pub total_duration_secs: i64,
    pub total_listen_secs: i64,
    pub today_duration_secs: i64,
    pub today_listen_secs: i64,
    pub total_days: i64,
    pub streak_days: i64,
    pub total_books: i64,
    pub daily_stats: Vec<DailyReadingStatItem>,
}


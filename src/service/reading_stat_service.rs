use chrono::{NaiveDate, Utc};
use sqlx::{Row, SqlitePool};

use crate::error::error::AppError;
use crate::model::reading_session::{
    BookReadingStatItem, DailyReadingStatItem, ReadingStatsSummaryResponse,
    RecordReadingHeartbeatRequest,
};
use crate::util::time::now_ts;

#[derive(Clone)]
pub struct ReadingStatService {
    pool: SqlitePool,
}

impl ReadingStatService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn record_heartbeat(
        &self,
        user_ns: &str,
        req: RecordReadingHeartbeatRequest,
    ) -> Result<(), AppError> {
        let book_url = req.book_url.trim();
        if book_url.is_empty() {
            return Err(AppError::BadRequest("bookUrl required".to_string()));
        }
        let book_name = req.book_name.trim();
        let author = req.author.as_deref().unwrap_or("").trim();
        let cover_url = req.cover_url.filter(|s| !s.trim().is_empty());

        let read_date = if let Some(d) = req.read_date {
            let trimmed = d.trim();
            if NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").is_ok() {
                trimmed.to_string()
            } else {
                Utc::now().format("%Y-%m-%d").to_string()
            }
        } else {
            Utc::now().format("%Y-%m-%d").to_string()
        };

        // 限制每次心跳增量秒数，防止异常大数（0 ~ 3600 秒）
        let duration_secs = req.duration_secs.clamp(0, 3600);
        let listen_secs = if req.is_listening.unwrap_or(false) {
            duration_secs
        } else {
            0
        };
        let chapters_read = req.chapters_delta.unwrap_or(0).clamp(0, 100) as i64;
        let ts = now_ts();

        sqlx::query(
            r#"
            INSERT INTO reading_sessions (
                user_ns, book_url, book_name, author, cover_url, read_date, duration_secs, listen_secs, chapters_read, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(user_ns, book_url, read_date) DO UPDATE SET
                book_name = CASE WHEN excluded.book_name != '' THEN excluded.book_name ELSE reading_sessions.book_name END,
                author = CASE WHEN excluded.author != '' THEN excluded.author ELSE reading_sessions.author END,
                cover_url = COALESCE(excluded.cover_url, reading_sessions.cover_url),
                duration_secs = reading_sessions.duration_secs + excluded.duration_secs,
                listen_secs = reading_sessions.listen_secs + excluded.listen_secs,
                chapters_read = reading_sessions.chapters_read + excluded.chapters_read,
                updated_at = excluded.updated_at;
            "#,
        )
        .bind(user_ns)
        .bind(book_url)
        .bind(book_name)
        .bind(author)
        .bind(cover_url)
        .bind(&read_date)
        .bind(duration_secs)
        .bind(listen_secs)
        .bind(chapters_read)
        .bind(ts)
        .execute(&self.pool)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

        Ok(())
    }

    pub async fn get_summary(
        &self,
        user_ns: &str,
        client_today: Option<&str>,
        book_url: Option<&str>,
    ) -> Result<ReadingStatsSummaryResponse, AppError> {
        let today = client_today
            .filter(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());

        // 1. 累计总量 (支持单书/全局)
        let total_row = if let Some(url) = book_url {
            sqlx::query(
                r#"
                SELECT 
                    COALESCE(SUM(duration_secs), 0) as total_duration,
                    COALESCE(SUM(listen_secs), 0) as total_listen,
                    COUNT(DISTINCT book_url) as total_books
                FROM reading_sessions
                WHERE user_ns = ?1 AND book_url = ?2;
                "#,
            )
            .bind(user_ns)
            .bind(url)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
        } else {
            sqlx::query(
                r#"
                SELECT 
                    COALESCE(SUM(duration_secs), 0) as total_duration,
                    COALESCE(SUM(listen_secs), 0) as total_listen,
                    COUNT(DISTINCT book_url) as total_books
                FROM reading_sessions
                WHERE user_ns = ?1;
                "#,
            )
            .bind(user_ns)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
        };

        let total_duration_secs: i64 = total_row.try_get("total_duration").unwrap_or(0);
        let total_listen_secs: i64 = total_row.try_get("total_listen").unwrap_or(0);
        let total_books: i64 = total_row.try_get("total_books").unwrap_or(0);

        // 2. 今日总量
        let today_row = if let Some(url) = book_url {
            sqlx::query(
                r#"
                SELECT 
                    COALESCE(SUM(duration_secs), 0) as today_duration,
                    COALESCE(SUM(listen_secs), 0) as today_listen
                FROM reading_sessions
                WHERE user_ns = ?1 AND read_date = ?2 AND book_url = ?3;
                "#,
            )
            .bind(user_ns)
            .bind(&today)
            .bind(url)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
        } else {
            sqlx::query(
                r#"
                SELECT 
                    COALESCE(SUM(duration_secs), 0) as today_duration,
                    COALESCE(SUM(listen_secs), 0) as today_listen
                FROM reading_sessions
                WHERE user_ns = ?1 AND read_date = ?2;
                "#,
            )
            .bind(user_ns)
            .bind(&today)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
        };

        let today_duration_secs: i64 = today_row.try_get("today_duration").unwrap_or(0);
        let today_listen_secs: i64 = today_row.try_get("today_listen").unwrap_or(0);

        // 3. 每日明细列表（近 365 天）
        let daily_rows = if let Some(url) = book_url {
            sqlx::query(
                r#"
                SELECT 
                    read_date,
                    COALESCE(SUM(duration_secs), 0) as duration_secs,
                    COALESCE(SUM(listen_secs), 0) as listen_secs,
                    COUNT(DISTINCT book_url) as book_count
                FROM reading_sessions
                WHERE user_ns = ?1 AND book_url = ?2
                GROUP BY read_date
                ORDER BY read_date ASC
                LIMIT 365;
                "#,
            )
            .bind(user_ns)
            .bind(url)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
        } else {
            sqlx::query(
                r#"
                SELECT 
                    read_date,
                    COALESCE(SUM(duration_secs), 0) as duration_secs,
                    COALESCE(SUM(listen_secs), 0) as listen_secs,
                    COUNT(DISTINCT book_url) as book_count
                FROM reading_sessions
                WHERE user_ns = ?1
                GROUP BY read_date
                ORDER BY read_date ASC
                LIMIT 365;
                "#,
            )
            .bind(user_ns)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
        };

        let mut daily_stats = Vec::new();
        let mut distinct_dates = Vec::new();

        for row in daily_rows {
            let r_date: String = row.try_get("read_date").unwrap_or_default();
            let d_secs: i64 = row.try_get("duration_secs").unwrap_or(0);
            let l_secs: i64 = row.try_get("listen_secs").unwrap_or(0);
            let b_cnt: i64 = row.try_get("book_count").unwrap_or(0);

            if d_secs > 0 {
                distinct_dates.push(r_date.clone());
            }

            daily_stats.push(DailyReadingStatItem {
                read_date: r_date,
                duration_secs: d_secs,
                listen_secs: l_secs,
                book_count: b_cnt,
            });
        }

        let total_days = distinct_dates.len() as i64;
        let streak_days = calculate_streak(&distinct_dates, &today);

        Ok(ReadingStatsSummaryResponse {
            total_duration_secs,
            total_listen_secs,
            today_duration_secs,
            today_listen_secs,
            total_days,
            streak_days,
            total_books,
            daily_stats,
        })
    }

    pub async fn get_book_stats(&self, user_ns: &str) -> Result<Vec<BookReadingStatItem>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT 
                book_url,
                book_name,
                author,
                cover_url,
                COALESCE(SUM(duration_secs), 0) as total_duration_secs,
                COALESCE(SUM(listen_secs), 0) as total_listen_secs,
                MIN(read_date) as first_read_date,
                MAX(read_date) as last_read_date,
                MAX(updated_at) as last_read_time,
                COUNT(DISTINCT read_date) as total_days,
                COALESCE(SUM(chapters_read), 0) as total_chapters_read
            FROM reading_sessions
            WHERE user_ns = ?1
            GROUP BY book_url
            ORDER BY total_duration_secs DESC;
            "#,
        )
        .bind(user_ns)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

        let mut list = Vec::new();
        for row in rows {
            list.push(BookReadingStatItem {
                book_url: row.try_get("book_url").unwrap_or_default(),
                book_name: row.try_get("book_name").unwrap_or_default(),
                author: row.try_get("author").unwrap_or_default(),
                cover_url: row.try_get("cover_url").ok(),
                total_duration_secs: row.try_get("total_duration_secs").unwrap_or(0),
                total_listen_secs: row.try_get("total_listen_secs").unwrap_or(0),
                first_read_date: row.try_get("first_read_date").unwrap_or_default(),
                last_read_date: row.try_get("last_read_date").unwrap_or_default(),
                last_read_time: row.try_get("last_read_time").ok(),
                total_days: row.try_get("total_days").unwrap_or(0),
                total_chapters_read: row.try_get("total_chapters_read").unwrap_or(0),
            });
        }

        Ok(list)
    }
}

fn calculate_streak(active_dates: &[String], today_str: &str) -> i64 {
    if active_dates.is_empty() {
        return 0;
    }

    let Ok(today) = NaiveDate::parse_from_str(today_str, "%Y-%m-%d") else {
        return 0;
    };

    let mut parsed_dates: Vec<NaiveDate> = active_dates
        .iter()
        .filter_map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .collect();
    parsed_dates.sort();
    parsed_dates.dedup();

    let mut current_target = today;
    let mut streak = 0;

    // 如果今天还没读，检查昨天是否有读过，从而不断签
    if !parsed_dates.contains(&current_target) {
        if let Some(yesterday) = current_target.pred_opt() {
            if parsed_dates.contains(&yesterday) {
                current_target = yesterday;
            } else {
                return 0;
            }
        } else {
            return 0;
        }
    }

    // 往前回溯统计连续天数
    while parsed_dates.contains(&current_target) {
        streak += 1;
        if let Some(prev) = current_target.pred_opt() {
            current_target = prev;
        } else {
            break;
        }
    }

    streak
}


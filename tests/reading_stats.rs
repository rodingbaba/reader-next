use reader_next::model::reading_session::RecordReadingHeartbeatRequest;
use reader_next::service::reading_stat_service::ReadingStatService;
use reader_next::storage::db;

fn temp_db_url(name: &str) -> (String, String) {
    let dir = std::env::temp_dir().join(format!(
        "reader-next-stat-test-{}-{}",
        name,
        std::process::id()
    ));
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("reader.db");
    let url = format!("sqlite:{}?mode=rwc", db_path.display());
    (url, dir.to_string_lossy().to_string())
}

#[tokio::test]
async fn reading_stats_records_heartbeats_and_summarizes() {
    let (database_url, _dir) = temp_db_url("stat-summary");
    let pool = db::init_pool(&database_url).await.unwrap();
    let service = ReadingStatService::new(pool);
    let user_ns = "test_user";

    // 1. 记录 2026-09-10 看书 60 秒
    service
        .record_heartbeat(
            user_ns,
            RecordReadingHeartbeatRequest {
                book_url: "book://1".to_string(),
                book_name: "乱世书".to_string(),
                author: Some("姬叉".to_string()),
                cover_url: None,
                read_date: Some("2026-09-10".to_string()),
                duration_secs: 60,
                is_listening: Some(false),
                chapters_delta: Some(1),
            },
        )
        .await
        .unwrap();

    // 2. 记录 2026-09-11 同一本书听书 120 秒
    service
        .record_heartbeat(
            user_ns,
            RecordReadingHeartbeatRequest {
                book_url: "book://1".to_string(),
                book_name: "乱世书".to_string(),
                author: Some("姬叉".to_string()),
                cover_url: None,
                read_date: Some("2026-09-11".to_string()),
                duration_secs: 120,
                is_listening: Some(true),
                chapters_delta: Some(0),
            },
        )
        .await
        .unwrap();

    // 3. 记录 2026-09-11 另一本书看书 30 秒
    service
        .record_heartbeat(
            user_ns,
            RecordReadingHeartbeatRequest {
                book_url: "book://2".to_string(),
                book_name: "江山如此多娇".to_string(),
                author: Some("泥人".to_string()),
                cover_url: None,
                read_date: Some("2026-09-11".to_string()),
                duration_secs: 30,
                is_listening: Some(false),
                chapters_delta: Some(1),
            },
        )
        .await
        .unwrap();

    // 检查全局 summary（以 2026-09-11 作为 today）
    let summary = service.get_summary(user_ns, Some("2026-09-11"), None).await.unwrap();
    assert_eq!(summary.total_duration_secs, 210); // 60 + 120 + 30
    assert_eq!(summary.total_listen_secs, 120);   // 听书 120
    assert_eq!(summary.today_duration_secs, 150); // 120 + 30
    assert_eq!(summary.today_listen_secs, 120);   // 听书 120
    assert_eq!(summary.total_books, 2);
    assert_eq!(summary.total_days, 2);
    assert_eq!(summary.streak_days, 2); // 9-10 和 9-11 连续 2 天

    // 检查单书 summary（只查 "book://1" 乱世书）
    let book1_summary = service.get_summary(user_ns, Some("2026-09-11"), Some("book://1")).await.unwrap();
    assert_eq!(book1_summary.total_duration_secs, 180); // 60 + 120
    assert_eq!(book1_summary.total_listen_secs, 120);
    assert_eq!(book1_summary.today_duration_secs, 120);
    assert_eq!(book1_summary.today_listen_secs, 120);
    assert_eq!(book1_summary.total_books, 1);
    assert_eq!(book1_summary.total_days, 2);
    assert_eq!(book1_summary.daily_stats.len(), 2);

    // 检查 book stats
    let book_stats = service.get_book_stats(user_ns).await.unwrap();
    assert_eq!(book_stats.len(), 2);
    assert_eq!(book_stats[0].book_name, "乱世书");
    assert_eq!(book_stats[0].total_duration_secs, 180); // 60 + 120
    assert_eq!(book_stats[0].total_listen_secs, 120);
    assert_eq!(book_stats[0].total_days, 2);

    assert_eq!(book_stats[1].book_name, "江山如此多娇");
    assert_eq!(book_stats[1].total_duration_secs, 30);
    assert_eq!(book_stats[1].total_listen_secs, 0);
}


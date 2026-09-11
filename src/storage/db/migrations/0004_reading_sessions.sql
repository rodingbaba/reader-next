CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_ns TEXT NOT NULL,
    book_url TEXT NOT NULL,
    book_name TEXT NOT NULL,
    author TEXT NOT NULL,
    cover_url TEXT,
    read_date TEXT NOT NULL,
    duration_secs INTEGER NOT NULL DEFAULT 0,
    listen_secs INTEGER NOT NULL DEFAULT 0,
    chapters_read INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_sessions_unique 
ON reading_sessions(user_ns, book_url, read_date);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_date 
ON reading_sessions(user_ns, read_date);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_book 
ON reading_sessions(user_ns, book_url);


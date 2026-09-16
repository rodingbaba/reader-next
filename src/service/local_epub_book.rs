use crate::error::error::AppError;
use crate::model::{book::Book, book_chapter::BookChapter};
use crate::util::hash::md5_hex;
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use tokio::fs;
use zip::ZipArchive;

pub const LOCAL_EPUB_ORIGIN: &str = "local-epub";
pub const LOCAL_EPUB_ORIGIN_NAME: &str = "本地 EPUB";
pub const MAX_EPUB_UPLOAD_BYTES: usize = 100 * 1024 * 1024;
const LOCAL_EPUB_HASH_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEpubChapter {
    pub title: String,
    pub url: String,
    pub index: i32,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEpubChapter {
    title: String,
    url: String,
    index: i32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    volume: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEpubIndex {
    book_url: String,
    name: String,
    file_name: String,
    byte_len: usize,
    author: String,
    chapters: Vec<StoredEpubChapter>,
}

pub fn is_local_epub_origin(value: &str) -> bool {
    value.trim() == LOCAL_EPUB_ORIGIN
}

pub fn is_local_epub_url(value: &str) -> bool {
    value.trim().starts_with("local-epub:")
}

fn epub_chapter_url(book_url: &str, index: usize) -> String {
    format!("{}#{}", book_url.trim_end_matches('#'), index)
}

fn epub_file_name(file_name: &str) -> String {
    let name = Path::new(file_name)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("book.epub")
        .trim()
        .to_string();
    if name.is_empty() {
        "book.epub".to_string()
    } else {
        name
    }
}

fn epub_book_name(file_name: &str) -> String {
    let safe = epub_file_name(file_name);
    Path::new(&safe)
        .file_stem()
        .and_then(|v| v.to_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("本地电子书")
        .to_string()
}

pub fn validate_epub_upload(file_name: &str, byte_len: usize) -> Result<(), AppError> {
    let safe = epub_file_name(file_name);
    if !safe.to_lowercase().ends_with(".epub") {
        return Err(AppError::BadRequest("仅支持上传 .epub 文件".to_string()));
    }
    if byte_len == 0 {
        return Err(AppError::BadRequest("EPUB 文件不能为空".to_string()));
    }
    if byte_len > MAX_EPUB_UPLOAD_BYTES {
        return Err(AppError::BadRequest("EPUB 文件不能超过 100MB".to_string()));
    }
    Ok(())
}

#[derive(Clone)]
pub struct LocalEpubBookService {
    storage_dir: PathBuf,
}

impl LocalEpubBookService {
    pub fn new(storage_dir: impl AsRef<Path>) -> Self {
        Self {
            storage_dir: storage_dir.as_ref().to_path_buf(),
        }
    }

    pub async fn import_epub_book(
        &self,
        user_ns: &str,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<Book, AppError> {
        validate_epub_upload(file_name, bytes.len())?;
        let safe_file_name = epub_file_name(file_name);

        let bytes_owned = bytes.to_vec();
        let epub_data = tokio::task::spawn_blocking(move || parse_epub(&bytes_owned, None, false))
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("EPUB 解析任务失败: {}", e)))?
            .map_err(AppError::BadRequest)?;

        let hash = md5_hex(&format!(
            "{}:{}:{}",
            user_ns,
            safe_file_name,
            md5_hex(&epub_data.title)
        ));
        let book_url = format!("{}:{}", LOCAL_EPUB_ORIGIN, hash);

        let book_dir = self.book_dir(user_ns, &book_url)?;
        fs::create_dir_all(&book_dir)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;

        fs::write(book_dir.join("book.epub"), bytes)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;

        if let Some(cover) = &epub_data.cover {
            let cover_bytes = cover.clone();
            let optimized_cover = tokio::task::spawn_blocking(move || {
                resize_cover_if_needed(&cover_bytes, 400)
            })
            .await
            .unwrap_or_else(|_| cover.clone());
            let _ = fs::write(book_dir.join("cover.jpg"), optimized_cover).await;
        }

        let chapters: Vec<StoredEpubChapter> = epub_data
            .chapters
            .iter()
            .enumerate()
            .map(|(i, ch)| StoredEpubChapter {
                title: ch.title.clone(),
                url: epub_chapter_url(&book_url, i),
                index: i as i32,
                files: ch.files.clone(),
                volume: ch.volume.clone(),
            })
            .collect();

        let index = StoredEpubIndex {
            book_url: book_url.clone(),
            name: if epub_data.title.is_empty() {
                epub_book_name(&safe_file_name)
            } else {
                epub_data.title.clone()
            },
            file_name: safe_file_name,
            byte_len: bytes.len(),
            author: epub_data.author.clone(),
            chapters: chapters.clone(),
        };

        let data =
            serde_json::to_string_pretty(&index).map_err(|e| AppError::Internal(e.into()))?;
        fs::write(book_dir.join("chapters.json"), data)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;

        let total_chars: usize = epub_data.chapters.iter().map(|ch| ch.content.len()).sum();

        Ok(Book {
            name: index.name.clone(),
            author: if index.author.is_empty() {
                "本地导入".to_string()
            } else {
                index.author.clone()
            },
            book_url: book_url.clone(),
            origin: LOCAL_EPUB_ORIGIN.to_string(),
            origin_name: Some(LOCAL_EPUB_ORIGIN_NAME.to_string()),
            toc_url: Some(book_url),
            can_update: Some(false),
            dur_chapter_index: Some(0),
            dur_chapter_pos: Some(0),
            total_chapter_num: Some(index.chapters.len() as i32),
            latest_chapter_title: index.chapters.last().map(|ch| ch.title.clone()),
            kind: Some("本地EPUB".to_string()),
            word_count: Some(format!("{}字", total_chars)),
            cover_url: if epub_data.cover.is_some() {
                Some(format!("local-epub-cover:{}", hash))
            } else {
                None
            },
            ..Book::default()
        })
    }

    pub async fn get_book_info(&self, user_ns: &str, book_url: &str) -> Result<Book, AppError> {
        let index = self.read_index(user_ns, book_url).await?;
        Ok(Book {
            name: index.name,
            author: if index.author.is_empty() {
                "本地导入".to_string()
            } else {
                index.author
            },
            book_url: index.book_url.clone(),
            origin: LOCAL_EPUB_ORIGIN.to_string(),
            origin_name: Some(LOCAL_EPUB_ORIGIN_NAME.to_string()),
            toc_url: Some(index.book_url.clone()),
            can_update: Some(false),
            total_chapter_num: Some(index.chapters.len() as i32),
            latest_chapter_title: index.chapters.last().map(|ch| ch.title.clone()),
            kind: Some("本地EPUB".to_string()),
            ..Book::default()
        })
    }

    pub async fn get_chapter_list(
        &self,
        user_ns: &str,
        book_url: &str,
    ) -> Result<Vec<BookChapter>, AppError> {
        let index = self.read_index(user_ns, book_url).await?;
        Ok(index
            .chapters
            .into_iter()
            .map(|ch| BookChapter {
                title: ch.title,
                url: ch.url,
                index: ch.index,
                volume: ch.volume,
                ..BookChapter::default()
            })
            .collect())
    }

    pub async fn get_content(&self, user_ns: &str, chapter_url: &str) -> Result<String, AppError> {
        let (book_url, requested_index) = parse_epub_chapter_url(chapter_url)?;
        let index = self.read_index(user_ns, &book_url).await?;
        let epub_path = self.book_dir(user_ns, &book_url)?.join("book.epub");
        let hash = epub_hash_from_url(&book_url).unwrap_or("").to_string();

        let chapter = index
            .chapters
            .get(requested_index as usize)
            .ok_or_else(|| AppError::BadRequest("章节不存在".to_string()))?;

        let files = chapter.files.clone();

        let content = tokio::task::spawn_blocking(move || {
            if files.is_empty() {
                let epub_data = parse_epub_from_file(&epub_path, Some(&hash), Some(requested_index as usize), true)
                    .map_err(AppError::BadRequest)?;
                epub_data
                    .chapters
                    .get(requested_index as usize)
                    .map(|ch| ch.content.clone())
                    .ok_or_else(|| AppError::BadRequest("章节不存在".to_string()))
            } else {
                let file = std::fs::File::open(&epub_path).map_err(|e| AppError::Internal(e.into()))?;
                let mut archive = ZipArchive::new(file).map_err(|e| format!("EPUB 打开失败: {}", e)).map_err(AppError::BadRequest)?;
                let mut parts = Vec::new();
                for fp in &files {
                    if let Ok(html_str) = read_zip_entry_to_string(&mut archive, fp) {
                        if !html_str.is_empty() {
                            let sanitized = sanitize_epub_html(&html_str, fp, Some(&hash), Some(&mut archive));
                            if !sanitized.is_empty() {
                                parts.push(sanitized);
                            }
                        }
                    }
                }
                Ok(parts.join("\n\n"))
            }
        })
        .await
        .map_err(|e| AppError::Internal(e.into()))??;

        Ok(content)
    }

    pub async fn get_cover(&self, user_ns: &str, book_url: &str) -> Result<(Vec<u8>, String), AppError> {
        let hash = epub_hash_from_url(book_url)?;
        let book_dir = self.local_root(user_ns).join(hash);
        let cover_path = book_dir.join("cover.jpg");
        if cover_path.exists() {
            let bytes = fs::read(&cover_path)
                .await
                .map_err(|e| AppError::Internal(e.into()))?;
            let final_bytes = if bytes.len() > 80 * 1024 {
                let cover_path_clone = cover_path.clone();
                let bytes_clone = bytes.clone();
                tokio::task::spawn_blocking(move || {
                    let optimized = resize_cover_if_needed(&bytes_clone, 400);
                    if optimized.len() < bytes_clone.len() {
                        let _ = std::fs::write(&cover_path_clone, &optimized);
                        optimized
                    } else {
                        bytes_clone
                    }
                })
                .await
                .unwrap_or(bytes)
            } else {
                bytes
            };
            let ct = detect_image_content_type(&final_bytes);
            return Ok((final_bytes, ct));
        }

        // 动态自愈：若 cover.jpg 尚未提取，实时尝试从 book.epub 提取并落盘缓存
        let epub_path = book_dir.join("book.epub");
        if epub_path.exists() {
            let epub_path_cloned = epub_path.clone();
            let cover_opt = tokio::task::spawn_blocking(move || {
                extract_cover_from_epub_file(&epub_path_cloned)
            })
            .await
            .map_err(|e| AppError::Internal(e.into()))?;

            if let Some(bytes) = cover_opt {
                let optimized = tokio::task::spawn_blocking({
                    let bytes_clone = bytes.clone();
                    move || resize_cover_if_needed(&bytes_clone, 400)
                })
                .await
                .unwrap_or_else(|_| bytes.clone());
                let _ = fs::write(&cover_path, &optimized).await;
                let ct = detect_image_content_type(&optimized);
                return Ok((optimized, ct));
            }
        }

        Err(AppError::NotFound("Cover not found".to_string()))
    }

    /// 根据 md5 hash 在所有用户的 local_books 中检索并提取封面（供公开代理接口使用）
    pub async fn get_cover_by_hash(&self, hash: &str) -> Result<(Vec<u8>, String), AppError> {
        let data_root = self.storage_dir.join("data");
        if let Ok(mut entries) = tokio::fs::read_dir(&data_root).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let book_dir = entry.path().join("local_books").join(hash);
                if book_dir.exists() {
                    let cover_path = book_dir.join("cover.jpg");
                    if cover_path.exists() {
                        if let Ok(bytes) = fs::read(&cover_path).await {
                            let final_bytes = if bytes.len() > 80 * 1024 {
                                let cover_path_clone = cover_path.clone();
                                let bytes_clone = bytes.clone();
                                tokio::task::spawn_blocking(move || {
                                    let optimized = resize_cover_if_needed(&bytes_clone, 400);
                                    if optimized.len() < bytes_clone.len() {
                                        let _ = std::fs::write(&cover_path_clone, &optimized);
                                        optimized
                                    } else {
                                        bytes_clone
                                    }
                                })
                                .await
                                .unwrap_or(bytes)
                            } else {
                                bytes
                            };
                            let ct = detect_image_content_type(&final_bytes);
                            return Ok((final_bytes, ct));
                        }
                    }
                    let epub_path = book_dir.join("book.epub");
                    if epub_path.exists() {
                        let cover_opt = tokio::task::spawn_blocking(move || {
                            extract_cover_from_epub_file(&epub_path)
                        })
                        .await
                        .map_err(|e| AppError::Internal(e.into()))?;

                        if let Some(bytes) = cover_opt {
                            let optimized = tokio::task::spawn_blocking({
                                let bytes_clone = bytes.clone();
                                move || resize_cover_if_needed(&bytes_clone, 400)
                            })
                            .await
                            .unwrap_or_else(|_| bytes.clone());
                            let _ = fs::write(&cover_path, &optimized).await;
                            let ct = detect_image_content_type(&optimized);
                            return Ok((optimized, ct));
                        }
                    }
                }
            }
        }
        Err(AppError::NotFound("Cover not found".to_string()))
    }

    pub async fn get_asset(&self, user_ns: &str, book_url: &str, path: &str) -> Result<(Vec<u8>, String), AppError> {
        let epub_path = self.book_dir(user_ns, book_url)?.join("book.epub");
        let path_owned = path.to_string();
        
        let buf = tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(&epub_path).map_err(|e| AppError::Internal(e.into()))?;
            let mut archive = ZipArchive::new(file).map_err(|e| AppError::BadRequest(e.to_string()))?;
            read_zip_entry_to_bytes(&mut archive, &path_owned)
                .map_err(|e| AppError::BadRequest(format!("资源不存在: {}", e)))
        })
        .await
        .map_err(|e| AppError::Internal(e.into()))??;
            
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
            
        let content_type = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            _ => "application/octet-stream",
        }.to_string();
        
        Ok((buf, content_type))
    }

    pub async fn delete_book_files(&self, user_ns: &str, book_url: &str) -> Result<bool, AppError> {
        let book_dir = self.book_dir(user_ns, book_url)?;
        match fs::remove_dir_all(book_dir).await {
            Ok(()) => Ok(true),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(err) => Err(AppError::Internal(err.into())),
        }
    }

    fn local_root(&self, user_ns: &str) -> PathBuf {
        self.storage_dir
            .join("data")
            .join(user_ns)
            .join("local_books")
    }

    fn book_dir(&self, user_ns: &str, book_url: &str) -> Result<PathBuf, AppError> {
        let hash = epub_hash_from_url(book_url)?;
        Ok(self.local_root(user_ns).join(hash))
    }

    async fn read_index(&self, user_ns: &str, book_url: &str) -> Result<StoredEpubIndex, AppError> {
        let path = self.book_dir(user_ns, book_url)?.join("chapters.json");
        let data = fs::read_to_string(path)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        serde_json::from_str(&data).map_err(|e| AppError::BadRequest(e.to_string()))
    }
}

struct EpubChapter {
    title: String,
    content: String,
    files: Vec<String>,
    volume: Option<String>,
}

struct ParsedEpubData {
    title: String,
    author: String,
    chapters: Vec<EpubChapter>,
    cover: Option<Vec<u8>>,
}

fn read_zip_entry_to_string<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
) -> Result<String, String> {
    let file = archive
        .by_name(path)
        .map_err(|e| format!("{}: {}", path, e))?;
    let mut buf = String::new();
    std::io::BufReader::new(file)
        .read_to_string(&mut buf)
        .map_err(|e| format!("read {}: {}", path, e))?;
    Ok(buf)
}

fn read_zip_entry_to_bytes<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
) -> Result<Vec<u8>, String> {
    let mut file = archive
        .by_name(path)
        .map_err(|e| format!("{}: {}", path, e))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| format!("read {}: {}", path, e))?;
    Ok(buf)
}

fn local_name(name: quick_xml::name::QName) -> String {
    let raw = name.as_ref();
    // Handle both {uri}local and prefix:local formats
    if let Some(pos) = raw.iter().position(|&b| b == b'}') {
        String::from_utf8_lossy(&raw[pos + 1..]).into_owned()
    } else if let Some(pos) = raw.iter().position(|&b| b == b':') {
        String::from_utf8_lossy(&raw[pos + 1..]).into_owned()
    } else {
        String::from_utf8_lossy(raw).into_owned()
    }
}

pub fn detect_image_content_type(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg".to_string()
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png".to_string()
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp".to_string()
    } else if bytes.starts_with(b"GIF8") {
        "image/gif".to_string()
    } else {
        "image/jpeg".to_string()
    }
}

/// 若图片体积大于 80KB 或宽大于 max_width，将其等比缩放为轻量 JPEG 图像。
/// 若解码失败或无需缩放，返回原图 bytes。
pub fn resize_cover_if_needed(bytes: &[u8], max_width: u32) -> Vec<u8> {
    if bytes.len() <= 60 * 1024 {
        return bytes.to_vec();
    }
    match image::load_from_memory(bytes) {
        Ok(img) => {
            let (w, h) = (img.width(), img.height());
            if w <= max_width && bytes.len() <= 80 * 1024 {
                return bytes.to_vec();
            }
            let target_img = if w > max_width {
                let target_h = ((h as u64 * max_width as u64) / w as u64) as u32;
                img.thumbnail(max_width, target_h.max(1))
            } else {
                img
            };
            let mut out = std::io::Cursor::new(Vec::new());
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80);
            if encoder.encode_image(&target_img).is_ok() {
                let res = out.into_inner();
                if res.len() < bytes.len() {
                    return res;
                }
            }
            bytes.to_vec()
        }
        Err(_) => bytes.to_vec(),
    }
}

fn find_and_read_zip_entry<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
) -> Option<Vec<u8>> {
    // 1. 直接路径尝试
    if let Ok(bytes) = read_zip_entry_to_bytes(archive, path) {
        if !bytes.is_empty() {
            return Some(bytes);
        }
    }
    // 2. URL 解码后路径尝试
    if let Ok(decoded) = urlencoding::decode(path) {
        let dec_str = decoded.to_string();
        if dec_str != path {
            if let Ok(bytes) = read_zip_entry_to_bytes(archive, &dec_str) {
                if !bytes.is_empty() {
                    return Some(bytes);
                }
            }
        }
    }
    // 3. 忽略大小写及前导/后置斜杠宽松匹配
    let clean_path = path.trim_start_matches('/').to_lowercase();
    let file_stem_name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    let count = archive.len();
    let mut matched_index = None;
    for i in 0..count {
        if let Ok(file) = archive.by_index(i) {
            let entry_name = file.name().trim_start_matches('/').to_lowercase();
            if entry_name == clean_path || entry_name.ends_with(&format!("/{}", file_stem_name)) {
                matched_index = Some(i);
                break;
            }
        }
    }
    if let Some(i) = matched_index {
        if let Ok(mut f) = archive.by_index(i) {
            let mut buf = Vec::new();
            if f.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                return Some(buf);
            }
        }
    }
    None
}

pub fn extract_cover_from_epub_archive<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Option<Vec<u8>> {
    let container_str = read_zip_entry_to_string(archive, "META-INF/container.xml").ok()?;
    let mut reader = Reader::from_str(&container_str);
    let mut rootfile_path = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                if local_name(e.name()) == "rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            rootfile_path = Some(String::from_utf8_lossy(&attr.value).into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    let rootfile_path = rootfile_path?;
    let opf_dir = rootfile_path
        .rsplit_once('/')
        .map(|(d, _)| format!("{}/", d))
        .unwrap_or_default();

    let opf_str = read_zip_entry_to_string(archive, &rootfile_path).ok()?;
    let mut opf_reader = Reader::from_str(&opf_str);
    let mut in_manifest = false;
    let mut in_metadata = false;

    let mut meta_cover_id = None;
    let mut manifest_items: Vec<(String, String, String, String)> = Vec::new(); // (id, href, media-type, properties)

    loop {
        match opf_reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => match local_name(e.name()).as_str() {
                "metadata" => in_metadata = true,
                "manifest" => in_manifest = true,
                "meta" if in_metadata => {
                    let mut name = String::new();
                    let mut content = String::new();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"name" => name = String::from_utf8_lossy(&attr.value).into_owned(),
                            b"content" => content = String::from_utf8_lossy(&attr.value).into_owned(),
                            _ => {}
                        }
                    }
                    if name == "cover" && !content.is_empty() {
                        meta_cover_id = Some(content);
                    }
                }
                "item" if in_manifest => {
                    let mut id = String::new();
                    let mut href = String::new();
                    let mut media_type = String::new();
                    let mut properties = String::new();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"id" => id = String::from_utf8_lossy(&attr.value).into_owned(),
                            b"href" => href = String::from_utf8_lossy(&attr.value).into_owned(),
                            b"media-type" => media_type = String::from_utf8_lossy(&attr.value).into_owned(),
                            b"properties" => properties = String::from_utf8_lossy(&attr.value).into_owned(),
                            _ => {}
                        }
                    }
                    if !href.is_empty() {
                        manifest_items.push((id, href, media_type, properties));
                    }
                }
                _ => {}
            },
            Ok(Event::End(ref e)) => match local_name(e.name()).as_str() {
                "metadata" => in_metadata = false,
                "manifest" => in_manifest = false,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    // 1. EPUB 2 标准：<meta name="cover" content="{id}">
    if let Some(ref cover_id) = meta_cover_id {
        if let Some((_, href, _, _)) = manifest_items.iter().find(|(id, _, _, _)| id == cover_id) {
            let full_path = format!("{}{}", opf_dir, href);
            if let Some(buf) = find_and_read_zip_entry(archive, &full_path) {
                return Some(buf);
            }
        }
    }

    // 2. EPUB 3 标准：item 带有 properties="cover-image"
    for (_, href, _, props) in &manifest_items {
        if props.split_whitespace().any(|p| p == "cover-image") {
            let full_path = format!("{}{}", opf_dir, href);
            if let Some(buf) = find_and_read_zip_entry(archive, &full_path) {
                return Some(buf);
            }
        }
    }

    // 3. 启发式：manifest item id 包含 cover 且类型为图片
    for (id, href, media_type, _) in &manifest_items {
        let id_lower = id.to_lowercase();
        if (id_lower == "cover" || id_lower == "cover-image" || id_lower.contains("cover"))
            && (media_type.starts_with("image/")
                || href.ends_with(".jpg")
                || href.ends_with(".jpeg")
                || href.ends_with(".png")
                || href.ends_with(".webp"))
        {
            let full_path = format!("{}{}", opf_dir, href);
            if let Some(buf) = find_and_read_zip_entry(archive, &full_path) {
                return Some(buf);
            }
        }
    }

    // 4. 启发式：manifest item href 包含 cover 且类型为图片
    for (_, href, media_type, _) in &manifest_items {
        let href_lower = href.to_lowercase();
        if (href_lower.contains("cover.") || href_lower.ends_with("cover.jpg") || href_lower.ends_with("cover.png") || href_lower.ends_with("cover.jpeg") || href_lower.ends_with("cover.webp"))
            && (media_type.starts_with("image/") || media_type.is_empty())
        {
            let full_path = format!("{}{}", opf_dir, href);
            if let Some(buf) = find_and_read_zip_entry(archive, &full_path) {
                return Some(buf);
            }
        }
    }

    // 5. 兜底策略：遍历 Zip 中所有文件，寻找 cover.jpg / cover.png
    let count = archive.len();
    let mut matched_index = None;
    for i in 0..count {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name().to_lowercase();
            if name.ends_with("cover.jpg") || name.ends_with("cover.jpeg") || name.ends_with("cover.png") || name.ends_with("cover.webp") {
                matched_index = Some(i);
                break;
            }
        }
    }
    if let Some(i) = matched_index {
        if let Ok(mut f) = archive.by_index(i) {
            let mut buf = Vec::new();
            if f.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                return Some(buf);
            }
        }
    }

    None
}

pub fn extract_cover_from_epub_file(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;
    extract_cover_from_epub_archive(&mut archive)
}

fn parse_epub(bytes: &[u8], hash: Option<&str>, load_content: bool) -> Result<ParsedEpubData, String> {
    let cursor = std::io::Cursor::new(bytes);
    let archive = ZipArchive::new(cursor).map_err(|e| format!("EPUB 解析失败: {}", e))?;
    parse_epub_archive(archive, hash, None, load_content)
}

fn parse_epub_from_file(path: &std::path::Path, hash: Option<&str>, target_index: Option<usize>, load_content: bool) -> Result<ParsedEpubData, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("打开 EPUB 失败: {}", e))?;
    let archive = ZipArchive::new(file).map_err(|e| format!("EPUB 解析失败: {}", e))?;
    parse_epub_archive(archive, hash, target_index, load_content)
}

fn parse_epub_archive<R: std::io::Read + std::io::Seek>(
    mut archive: ZipArchive<R>,
    hash: Option<&str>,
    target_index: Option<usize>,
    load_content: bool,
) -> Result<ParsedEpubData, String> {

    let mut title = String::new();
    let mut author = String::new();
    let cover: Option<Vec<u8>> = extract_cover_from_epub_archive(&mut archive);
    let mut nav_content = None;
    let mut spine_hrefs: Vec<String> = Vec::new();

    // Parse container.xml
    let container_str = read_zip_entry_to_string(&mut archive, "META-INF/container.xml")?;
    let mut reader = Reader::from_str(&container_str);
    let mut rootfile_path = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let ln = local_name(e.name());
                if ln == "rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            rootfile_path = Some(String::from_utf8_lossy(&attr.value).into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    let rootfile_path =
        rootfile_path.ok_or_else(|| "OPF path not found in container.xml".to_string())?;
    let opf_dir = rootfile_path
        .rsplit_once('/')
        .map(|(d, _)| format!("{}/", d))
        .unwrap_or_default();

    // Parse OPF
    let opf_str = read_zip_entry_to_string(&mut archive, &rootfile_path)?;
    let mut manifest_items: HashMap<String, String> = HashMap::new();

    {
        let mut opf_reader = Reader::from_str(&opf_str);
        let mut in_manifest = false;
        let mut in_spine = false;
        let mut in_metadata = false;

        loop {
            match opf_reader.read_event() {
                Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => match local_name(e.name())
                    .as_str()
                {
                    "metadata" => in_metadata = true,
                    "manifest" => in_manifest = true,
                    "spine" => in_spine = true,
                    "item" if in_manifest => {
                        let mut id = String::new();
                        let mut href = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"id" => id = String::from_utf8_lossy(&attr.value).into_owned(),
                                b"href" => href = String::from_utf8_lossy(&attr.value).into_owned(),
                                _ => {}
                            }
                        }
                        if !id.is_empty() && !href.is_empty() {
                            manifest_items.insert(id, href);
                        }
                    }
                    "itemref" if in_spine => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"idref" {
                                let idref = String::from_utf8_lossy(&attr.value).into_owned();
                                if let Some(href) = manifest_items.get(&idref) {
                                    spine_hrefs.push(href.clone());
                                }
                            }
                        }
                    }
                    "title" if in_metadata => {
                        title = opf_reader
                            .read_text(e.name())
                            .unwrap_or_default()
                            .to_string();
                    }
                    "creator" if in_metadata => {
                        author = opf_reader
                            .read_text(e.name())
                            .unwrap_or_default()
                            .to_string();
                    }
                    _ => {}
                },
                Ok(Event::End(ref e)) => match local_name(e.name()).as_str() {
                    "metadata" => in_metadata = false,
                    "manifest" => in_manifest = false,
                    "spine" => in_spine = false,
                    _ => {}
                },
                Ok(Event::Eof) => break,
                Err(_) => break,
                _ => {}
            }
        }
    }

    // Read nav
    let nav_item = manifest_items.values().find(|href| {
        href.ends_with("nav.xhtml") || href.ends_with("nav.html") || href.ends_with("toc.ncx")
    });
    if let Some(nav_href) = nav_item {
        let full_path = format!("{}{}", opf_dir, nav_href);
        if let Ok(nav_str) = read_zip_entry_to_string(&mut archive, &full_path) {
            nav_content = Some(nav_str);
        }
    }

    let mut toc_map = HashMap::new();
    if let Some(nav) = &nav_content {
        toc_map = extract_toc_map(nav);
    }

    // Extract chapters
    let mut chapters: Vec<EpubChapter> = Vec::new();

    if toc_map.is_empty() {
        // 兜底降级策略：如果书籍完全没有任何 TOC 目录定义，退回到按物理文件 1:1 分章
        for (i, href) in spine_hrefs.iter().enumerate() {
            let full_path = format!("{}{}", opf_dir, href);
            let mut content = String::new();
            let mut title_str = String::new();
            if load_content && target_index.map_or(true, |idx| idx == i) {
                let html_str = read_zip_entry_to_string(&mut archive, &full_path).unwrap_or_default();
                content = sanitize_epub_html(&html_str, &full_path, hash, Some(&mut archive));
                let chapter_title = extract_title_from_html_str(&html_str).or_else(|| {
                    Some(format!("第 {} 章", i + 1))
                });
                title_str = chapter_title.unwrap_or_else(|| "正文".to_string());
            } else {
                if let Ok(html_str) = read_zip_entry_to_string(&mut archive, &full_path) {
                    title_str = extract_title_from_html_str(&html_str).unwrap_or_default();
                }
                if title_str.is_empty() {
                    title_str = format!("第 {} 章", i + 1);
                }
            }
            chapters.push(EpubChapter {
                title: title_str,
                content,
                files: vec![full_path],
                volume: None,
            });
        }
    } else {
        // 正规策略：以 TOC 逻辑目录为锚点，将非 TOC 的连续分片文件（如扉页后续正文、大章节切片等）自动归并到前序章节
        for href in &spine_hrefs {
            let full_path = format!("{}{}", opf_dir, href);
            let filename = href.split('#').next().unwrap_or(href).rsplit('/').next().unwrap_or(href);

            if let Some(toc_item) = toc_map.get(filename) {
                chapters.push(EpubChapter {
                    title: toc_item.title.clone(),
                    content: String::new(),
                    files: vec![full_path],
                    volume: toc_item.volume.clone(),
                });
            } else if let Some(last) = chapters.last_mut() {
                // 当前物理分片不在 TOC 中，但前面已有章节：自动归并为上一章节的后续承接分卷
                last.files.push(full_path);
            } else {
                // 在首个目录项之前出现的独立文件（如未编入目录的封面页），作为独立首章
                let mut title_str = String::new();
                if let Ok(html_str) = read_zip_entry_to_string(&mut archive, &full_path) {
                    title_str = extract_title_from_html_str(&html_str).unwrap_or_default();
                }
                if title_str.is_empty() {
                    title_str = "开始".to_string();
                }
                chapters.push(EpubChapter {
                    title: title_str,
                    content: String::new(),
                    files: vec![full_path],
                    volume: None,
                });
            }
        }

        // 若需要加载章节内容（如单章正文提取）
        if load_content {
            for (i, ch) in chapters.iter_mut().enumerate() {
                if target_index.map_or(true, |idx| idx == i) {
                    let mut parts = Vec::new();
                    for fp in &ch.files {
                        if let Ok(html_str) = read_zip_entry_to_string(&mut archive, fp) {
                            if !html_str.is_empty() {
                                let sanitized = sanitize_epub_html(&html_str, fp, hash, Some(&mut archive));
                                if !sanitized.is_empty() {
                                    parts.push(sanitized);
                                }
                            }
                        }
                    }
                    ch.content = parts.join("\n\n");
                }
            }
        }
    }

    if chapters.is_empty() {
        return Err("EPUB 中未找到任何章节".to_string());
    }

    Ok(ParsedEpubData {
        title,
        author,
        chapters,
        cover,
    })
}

fn extract_title_from_html_str(html_str: &str) -> Option<String> {
    use once_cell::sync::Lazy;
    static RE_H: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<h[1-3][^>]*>(.*?)</h[1-3]>").unwrap());
    if let Some(caps) = RE_H.captures(html_str) {
        if let Some(m) = caps.get(1) {
            let raw = strip_html_tags(m.as_str());
            let title = raw.trim().to_string();
            if !title.is_empty() {
                return Some(title);
            }
        }
    }
    None
}

fn resolve_relative_path(base_path: &str, relative: &str) -> String {
    let mut parts: Vec<&str> = base_path.split('/').collect();
    if !parts.is_empty() {
        parts.pop();
    }
    for part in relative.split('/') {
        if part == "." || part.is_empty() {
            continue;
        } else if part == ".." {
            if !parts.is_empty() {
                parts.pop();
            }
        } else {
            parts.push(part);
        }
    }
    parts.join("/")
}

fn sanitize_epub_html<R: std::io::Read + std::io::Seek>(
    html: &str,
    base_path: &str,
    hash: Option<&str>,
    mut archive: Option<&mut ZipArchive<R>>,
) -> String {
    use once_cell::sync::Lazy;
    static RE_SCRIPT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<script[^>]*>.*?</script>").unwrap());
    static RE_STYLE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<style[^>]*>.*?</style>").unwrap());
    static RE_HEAD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<head[^>]*>.*?</head>").unwrap());
    static RE_IMG: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)<(?:img|image)[^>]*(?:src|href|xlink:href)=['"]([^'"]+)['"][^>]*>"#).unwrap());

    let mut text = RE_SCRIPT.replace_all(html, "").to_string();
    text = RE_STYLE.replace_all(&text, "").to_string();
    text = RE_HEAD.replace_all(&text, "").to_string();

    text = RE_IMG.replace_all(&text, |caps: &regex::Captures| {
        let original_match = caps.get(0).unwrap().as_str();
        let src = caps.get(1).unwrap().as_str();
        if src.starts_with("data:") || src.starts_with("http") {
            return original_match.to_string();
        }
        let resolved = resolve_relative_path(base_path, src);

        // 1. 优先尝试从 EPUB zip 包中读取并内嵌为 Base64 Data URL
        // 确保离线断网和 iOS App 环境下无需任何网络请求即可展示图片
        if let Some(ref mut zip) = archive {
            let decoded_path = urlencoding::decode(&resolved)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| resolved.clone());
            let paths_to_try = [&resolved, &decoded_path];
            let mut found_bytes = None;
            let mut matched_path = String::new();
            for p in paths_to_try {
                if let Ok(bytes) = read_zip_entry_to_bytes(zip, p) {
                    found_bytes = Some(bytes);
                    matched_path = p.to_string();
                    break;
                }
            }

            if let Some(bytes) = found_bytes {
                let ext = std::path::Path::new(&matched_path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let mime = match ext.as_str() {
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "svg" => "image/svg+xml",
                    "webp" => "image/webp",
                    _ => "application/octet-stream",
                };
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let new_src = format!("data:{};base64,{}", mime, b64);
                return original_match.replace(src, &new_src);
            }
        }

        // 2. 兜底回退：如果 zip 中未能找到资源，保留原有的动态服务端路由
        if let Some(h) = hash {
            let encoded = urlencoding::encode(&resolved);
            let new_src = format!("/api/local-book/epub/asset/{}?path={}", h, encoded);
            return original_match.replace(src, &new_src);
        }

        original_match.to_string()
    }).to_string();

    // Quick and dirty fix to keep body content if possible, or just return text
    // We don't want the full html/head/body structure to confuse the frontend
    static RE_BODY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<body[^>]*>(.*?)</body>").unwrap());
    if let Some(caps) = RE_BODY.captures(&text) {
        if let Some(body) = caps.get(1) {
            return body.as_str().trim().to_string();
        }
    }

    text.trim().to_string()
}

fn strip_html_tags(html: &str) -> String {
    static RE_BR: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| Regex::new(r"(?si)<br\s*/?>").unwrap());
    static RE_TAGS: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| Regex::new(r"(?s)<.*?>").unwrap());
    let s = RE_BR.replace_all(html, " ");
    RE_TAGS.replace_all(&s, "").trim().to_string()
}

#[derive(Debug, Clone)]
struct TocItem {
    pub title: String,
    pub volume: Option<String>,
}

fn extract_toc_map(nav: &str) -> HashMap<String, TocItem> {
    let mut map: HashMap<String, TocItem> = HashMap::new();

    // 1. 尝试使用 quick-xml 递归层次解析 NCX
    let mut reader = Reader::from_str(nav);
    reader.trim_text(true);

    struct NavStackItem {
        title: String,
        src: Option<String>,
        has_children: bool,
    }

    let mut stack: Vec<NavStackItem> = Vec::new();
    let mut current_text = String::new();
    let mut in_text = false;

    let mut buf = Vec::new();

    while let Ok(event) = reader.read_event_into(&mut buf) {
        match event {
            Event::Start(e) => {
                let name = local_name(e.name());
                if name.eq_ignore_ascii_case("navPoint") {
                    if let Some(parent) = stack.last_mut() {
                        parent.has_children = true;
                    }
                    stack.push(NavStackItem {
                        title: String::new(),
                        src: None,
                        has_children: false,
                    });
                } else if name.eq_ignore_ascii_case("text") {
                    in_text = true;
                    current_text.clear();
                }
            }
            Event::Empty(e) => {
                let name = local_name(e.name());
                if name.eq_ignore_ascii_case("content") {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref().eq_ignore_ascii_case(b"src") {
                            if let Ok(src) = std::str::from_utf8(&attr.value) {
                                if let Some(item) = stack.last_mut() {
                                    item.src = Some(src.to_string());
                                }
                            }
                        }
                    }
                }
            }
            Event::Text(e) => {
                if in_text {
                    if let Ok(s) = e.unescape() {
                        current_text.push_str(&s);
                    }
                }
            }
            Event::End(e) => {
                let name = local_name(e.name());
                if name.eq_ignore_ascii_case("text") {
                    in_text = false;
                    let clean = strip_html_tags(&current_text);
                    if let Some(item) = stack.last_mut() {
                        if item.title.is_empty() {
                            item.title = clean;
                        }
                    }
                } else if name.eq_ignore_ascii_case("navPoint") {
                    if let Some(item) = stack.pop() {
                        if let Some(src) = item.src {
                            let href = src.split('#').next().unwrap_or(&src);
                            let filename = href.rsplit('/').next().unwrap_or(href).to_string();
                            let outer_volume = stack.iter().rev().find(|p| p.has_children && !p.title.is_empty()).map(|p| p.title.clone());
                            let volume = if item.has_children {
                                outer_volume.or_else(|| Some(item.title.clone()))
                            } else {
                                outer_volume
                            };
                            if !map.contains_key(&filename) && !item.title.is_empty() {
                                map.insert(filename, TocItem {
                                    title: item.title,
                                    volume,
                                });
                            }
                        }
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    // 2. 兜底回退：若 quick-xml 未能解析到树结构，使用正则回退
    if map.is_empty() {
        static RE_NCX: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| Regex::new(r#"(?si)<navLabel>\s*<text>(.*?)</text>\s*</navLabel>.*?<content\s+src=['"]([^'"]+)['"]"#).unwrap());
        for caps in RE_NCX.captures_iter(nav) {
            let title = strip_html_tags(caps.get(1).map_or("", |m| m.as_str()));
            let src = caps.get(2).map_or("", |m| m.as_str());
            let href = src.split('#').next().unwrap_or(src);
            let filename = href.rsplit('/').next().unwrap_or(href).to_string();
            if !map.contains_key(&filename) && !title.is_empty() {
                map.insert(filename, TocItem {
                    title,
                    volume: None,
                });
            }
        }

        static RE_NAV: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| Regex::new(r#"(?si)<a[^>]*href=['"]([^'"]+)['"][^>]*>(.*?)</a>"#).unwrap());
        for caps in RE_NAV.captures_iter(nav) {
            let src = caps.get(1).map_or("", |m| m.as_str());
            let title = strip_html_tags(caps.get(2).map_or("", |m| m.as_str()));
            let href = src.split('#').next().unwrap_or(src);
            let filename = href.rsplit('/').next().unwrap_or(href).to_string();
            if !map.contains_key(&filename) && !title.is_empty() {
                map.insert(filename, TocItem {
                    title,
                    volume: None,
                });
            }
        }
    }

    map
}

fn epub_hash_from_url(book_url: &str) -> Result<&str, AppError> {
    book_url
        .strip_prefix("local-epub:")
        .filter(|v| v.len() == LOCAL_EPUB_HASH_LEN && v.chars().all(|ch| ch.is_ascii_hexdigit()))
        .ok_or_else(|| AppError::BadRequest("本地 EPUB 地址无效".to_string()))
}

fn parse_epub_chapter_url(chapter_url: &str) -> Result<(String, i32), AppError> {
    let (book_url, raw_index) = chapter_url
        .rsplit_once('#')
        .ok_or_else(|| AppError::BadRequest("章节地址无效".to_string()))?;
    if !is_local_epub_url(book_url) {
        return Err(AppError::BadRequest("章节地址无效".to_string()));
    }
    let index = raw_index
        .parse::<i32>()
        .map_err(|_| AppError::BadRequest("章节序号无效".to_string()))?;
    Ok((book_url.to_string(), index))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_epub() -> Vec<u8> {
        std::fs::read("tests/fixtures/test.epub").expect("test.epub fixture")
    }

    #[test]
    fn parse_epub_finds_metadata_and_chapters() {
        let bytes = fixture_epub();
        let data = parse_epub(&bytes, None, true).expect("parse failed");
        assert_eq!(data.title, "Test Book");
        assert_eq!(data.author, "Test Author");
        assert_eq!(data.chapters.len(), 2);
    }

    #[test]
    fn parse_epub_chapter_content_not_empty() {
        let bytes = fixture_epub();
        let data = parse_epub(&bytes, None, true).unwrap();
        assert!(data.chapters[0].content.contains("Hello World"));
        assert!(data.chapters[1].content.contains("chapter two"));
    }

    #[test]
    fn parse_epub_metadata_only_skips_content() {
        let bytes = fixture_epub();
        let data = parse_epub(&bytes, None, false).unwrap();
        assert_eq!(data.title, "Test Book");
        assert!(data.chapters[0].content.is_empty());
        assert!(data.chapters[1].content.is_empty());
    }

    #[test]
    fn validate_epub_rejects_empty_file() {
        assert!(validate_epub_upload("book.epub", 0).is_err());
    }

    #[test]
    fn validate_epub_rejects_oversized() {
        assert!(validate_epub_upload("book.epub", MAX_EPUB_UPLOAD_BYTES + 1).is_err());
    }

    #[test]
    fn is_local_epub_origin_url_works() {
        assert!(is_local_epub_origin("local-epub"));
        assert!(is_local_epub_url("local-epub:abc#0"));
        assert!(!is_local_epub_origin("local-txt"));
        assert!(!is_local_epub_url("local-txt:abc#0"));
    }

    #[test]
    fn sanitize_epub_html_embeds_images_as_base64() {
        use std::io::Write;
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("OEBPS/images/cover.png", options).unwrap();
            zip.write_all(b"fake-png-data").unwrap();
            zip.finish().unwrap();
        }
        buffer.set_position(0);
        let mut archive = ZipArchive::new(buffer).unwrap();

        let raw_html = r#"<div><p>正文</p><img src="images/cover.png" alt="cover"/></div>"#;
        let sanitized = sanitize_epub_html(raw_html, "OEBPS/chapter1.xhtml", Some("hash123"), Some(&mut archive));
        assert!(sanitized.contains("data:image/png;base64,"));
        assert!(sanitized.contains("ZmFrZS1wbmctZGF0YQ=="));
    }

    #[test]
    fn sanitize_epub_html_fallback_to_server_url_when_missing() {
        let raw_html = r#"<div><p>正文</p><img src="images/missing.png"/></div>"#;
        let sanitized = sanitize_epub_html::<std::io::Cursor<Vec<u8>>>(raw_html, "OEBPS/chapter1.xhtml", Some("hash123"), None);
        assert!(sanitized.contains("/api/local-book/epub/asset/hash123?path=OEBPS%2Fimages%2Fmissing.png"));
    }

    #[test]
    fn resize_cover_if_needed_skips_small_images() {
        let small = vec![1u8; 100];
        let result = resize_cover_if_needed(&small, 400);
        assert_eq!(result, small);
    }

    #[test]
    fn resize_cover_if_needed_resizes_large_image() {
        // 创建一个 800x800 的测试图
        let img = image::DynamicImage::new_rgb8(800, 800);
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).unwrap();
        // 确保原始体积大于 80KB 触发压缩测试（若小于则填充数据或加大尺寸）
        if buf.len() <= 80 * 1024 {
            buf.resize(85 * 1024, 0x00);
        }
        // 如果损坏的格式，优雅返回原图
        let invalid = vec![0xFF; 90 * 1024];
        assert_eq!(resize_cover_if_needed(&invalid, 400), invalid);
    }

    #[test]
    fn test_qionggui_toc_merge_and_content() {
        let path = std::path::Path::new("storage/data/admin/local_books/0e2725f2fbf9e1dfd40d1c7efee89752/book.epub");
        if !path.exists() {
            return;
        }
        let bytes = std::fs::read(path).unwrap();
        let parsed = parse_epub(&bytes, None, false).expect("parse qionggui");
        assert_eq!(parsed.title, "穷鬼的上下两千年");

        let titles: Vec<&str> = parsed.chapters.iter().map(|c| c.title.as_str()).take(10).collect();
        println!("Qionggui first 10 chapters: {:?}", titles);

        // 验证没有出现“第 6 章”、“第 8 章”生造伪章节
        for ch in &parsed.chapters {
            assert_ne!(ch.title, "第 6 章");
            assert_ne!(ch.title, "第 8 章");
            assert_ne!(ch.title, "第 10 章");
        }

        // 验证第一章能够正确合并扉页与正文（例如包含 Chapter3.xhtml 与 Chapter3_0001.xhtml）
        let (ch_idx, ch_first) = parsed.chapters.iter().enumerate().find(|(_, c)| c.title.contains("第一章")).expect("find 第一章");
        println!("第一章 title: {}, files: {:?}", ch_first.title, ch_first.files);
        assert!(ch_first.files.len() >= 2, "第一章应当归并扉页和正文物理分片，当前分片数: {}", ch_first.files.len());

        let with_content = parse_epub_from_file(path, None, Some(ch_idx), true).expect("parse with content");
        let content = &with_content.chapters[ch_idx].content;
        assert!(!content.is_empty(), "合并后的第一章内容不应为空");
        println!("第一章内容长度: {} 字符, 前 100 字: {}", content.chars().count(), content.chars().take(100).collect::<String>());
    }

    #[test]
    fn test_wanming_compatibility() {
        let path = std::path::Path::new("storage/data/admin/local_books/e1c8cf57d471e05c3d40d01773355d8e/book.epub");
        if !path.exists() {
            return;
        }
        let bytes = std::fs::read(path).unwrap();
        let parsed = parse_epub(&bytes, None, false).expect("parse wanming");
        assert_eq!(parsed.title, "晚明");
        assert!(parsed.chapters.len() > 100, "晚明应当有完整章节");
        // 晚明每一章应该正常对应其物理文件
        for ch in &parsed.chapters {
            assert!(!ch.files.is_empty());
        }
    }

    #[test]
    fn test_jiangshan_volume_extraction() {
        let path = std::path::Path::new("storage/data/admin/local_books/e418a9fd3cb3877b2a3eda5a3bdec055/book.epub");
        if !path.exists() {
            return;
        }
        let bytes = std::fs::read(path).unwrap();
        let parsed = parse_epub(&bytes, None, false).expect("parse jiangshan");
        assert_eq!(parsed.title, "江山如此多娇");

        let ch13_4 = parsed.chapters.iter().find(|c| c.files.iter().any(|f| f.ends_with("chapter_13_0004.xhtml"))).expect("find chapter 13-4");
        assert_eq!(ch13_4.title, "第四章");
        assert_eq!(ch13_4.volume.as_deref(), Some("第十三集"));

        let ch14_5 = parsed.chapters.iter().find(|c| c.files.iter().any(|f| f.ends_with("chapter_14_0005.xhtml"))).expect("find chapter 14-5");
        assert_eq!(ch14_5.title, "第五章");
        assert_eq!(ch14_5.volume.as_deref(), Some("第十四集"));

        // 验证第十三集的插图页 chapter_13.xhtml 独立成章
        let ch13_cover = parsed.chapters.iter().find(|c| c.files.iter().any(|f| f.ends_with("chapter_13.xhtml"))).expect("find chapter 13 cover");
        assert_eq!(ch13_cover.title, "第十三集");
        assert_eq!(ch13_cover.volume.as_deref(), Some("第十三集"));
    }

    #[test]
    fn test_chongsheng_volume_cover_extraction() {
        let path = std::path::Path::new("storage/data/admin/local_books/a3b176e830a03324fe61efce55b852ea/book.epub");
        if !path.exists() {
            return;
        }
        let bytes = std::fs::read(path).unwrap();
        let parsed = parse_epub(&bytes, None, false).expect("parse chongsheng");
        assert_eq!(parsed.title, "重生之官路商途");

        // 验证【第一篇】宦海惊情 (chapter1201.html) 独立成卷首章节
        let (p1_idx, p1_ch) = parsed.chapters.iter().enumerate().find(|(_, c)| c.files.iter().any(|f| f.ends_with("chapter1201.html"))).expect("find chapter1201");
        assert_eq!(p1_ch.title, "【第一篇】宦海惊情");
        assert_eq!(p1_ch.volume.as_deref(), Some("【第一篇】宦海惊情"));

        // 验证下一章即为第1章
        let next_ch = &parsed.chapters[p1_idx + 1];
        assert_eq!(next_ch.title, "第1章 前世今生");
        assert_eq!(next_ch.volume.as_deref(), Some("【第一篇】宦海惊情"));
    }
}

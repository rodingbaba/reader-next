use crate::error::error::AppError;
use crate::model::{book::Book, book_chapter::BookChapter};
use crate::util::hash::md5_hex;
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read};
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

        let epub_data = parse_epub(bytes, None).map_err(AppError::BadRequest)?;

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
            let _ = fs::write(book_dir.join("cover.jpg"), cover).await;
        }

        let chapters: Vec<StoredEpubChapter> = epub_data
            .chapters
            .iter()
            .enumerate()
            .map(|(i, ch)| StoredEpubChapter {
                title: ch.title.clone(),
                url: epub_chapter_url(&book_url, i),
                index: i as i32,
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
                ..BookChapter::default()
            })
            .collect())
    }

    pub async fn get_content(&self, user_ns: &str, chapter_url: &str) -> Result<String, AppError> {
        let (book_url, requested_index) = parse_epub_chapter_url(chapter_url)?;
        let _index = self.read_index(user_ns, &book_url).await?;

        let epub_path = self.book_dir(user_ns, &book_url)?.join("book.epub");
        let hash = epub_hash_from_url(&book_url).unwrap_or("").to_string();

        let content = tokio::task::spawn_blocking(move || {
            let epub_data = parse_epub_from_file(&epub_path, Some(&hash), Some(requested_index as usize))
                .map_err(AppError::BadRequest)?;
            
            epub_data
                .chapters
                .get(requested_index as usize)
                .map(|ch| ch.content.clone())
                .ok_or_else(|| AppError::BadRequest("章节不存在".to_string()))
        })
        .await
        .map_err(|e| AppError::Internal(e.into()))??;

        Ok(content)
    }

    pub async fn get_cover(&self, user_ns: &str, book_url: &str) -> Result<Vec<u8>, AppError> {
        let hash = epub_hash_from_url(book_url)?;
        let cover_path = self.local_root(user_ns).join(hash).join("cover.jpg");
        fs::read(&cover_path)
            .await
            .map_err(|e| AppError::Internal(e.into()))
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

fn parse_epub(bytes: &[u8], hash: Option<&str>) -> Result<ParsedEpubData, String> {
    let cursor = std::io::Cursor::new(bytes);
    let archive = ZipArchive::new(cursor).map_err(|e| format!("EPUB 解析失败: {}", e))?;
    parse_epub_archive(archive, hash, None)
}

fn parse_epub_from_file(path: &std::path::Path, hash: Option<&str>, target_index: Option<usize>) -> Result<ParsedEpubData, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let archive = ZipArchive::new(file).map_err(|e| format!("EPUB 解析失败: {}", e))?;
    parse_epub_archive(archive, hash, target_index)
}

fn parse_epub_archive<R: std::io::Read + std::io::Seek>(
    mut archive: ZipArchive<R>,
    hash: Option<&str>,
    target_index: Option<usize>,
) -> Result<ParsedEpubData, String> {

    let mut title = String::new();
    let mut author = String::new();
    let mut cover: Option<Vec<u8>> = None;
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
                    "meta" if in_metadata => {
                        let mut name = String::new();
                        let mut content = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"name" => name = String::from_utf8_lossy(&attr.value).into_owned(),
                                b"content" => {
                                    content = String::from_utf8_lossy(&attr.value).into_owned()
                                }
                                _ => {}
                            }
                        }
                        if name == "cover" {
                            if let Some(href) = manifest_items.get(&content) {
                                let full_path = format!("{}{}", opf_dir, href);
                                if let Ok(buf) = read_zip_entry_to_bytes(&mut archive, &full_path) {
                                    if !buf.is_empty() {
                                        cover = Some(buf);
                                    }
                                }
                            }
                        }
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

    // Extract chapters
    let mut chapters = Vec::new();
    for (i, href) in spine_hrefs.iter().enumerate() {
        let full_path = format!("{}{}", opf_dir, href);
        let mut content = String::new();
        let mut title_str = String::new();
        
        if target_index.map_or(true, |idx| idx == i) {
            let html_str = read_zip_entry_to_string(&mut archive, &full_path).unwrap_or_default();
            content = sanitize_epub_html(&html_str, &full_path, hash);
            let chapter_title = extract_title_from_html_str(&html_str).or_else(|| {
                Some(format!("第 {} 章", i + 1))
            });
            title_str = chapter_title.unwrap_or_else(|| "正文".to_string());
        } else {
            title_str = format!("第 {} 章", i + 1);
        }

        chapters.push(EpubChapter {
            title: title_str,
            content,
        });
    }

    if let Some(nav) = &nav_content {
        let nav_titles = extract_nav_titles(nav);
        for (i, ch) in chapters.iter_mut().enumerate() {
            if ch.title.starts_with("第 ") && i < nav_titles.len() {
                ch.title = nav_titles[i].clone();
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

fn extract_title_from_html_str(html: &str) -> Option<String> {
    let mut reader = Reader::from_str(html);
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if local_name(e.name()) == "title" => {
                let text = reader.read_text(e.name()).ok()?;
                let text = text.trim().to_string();
                if !text.is_empty() {
                    return Some(text);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    let mut reader = Reader::from_str(html);
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let ln = local_name(e.name());
                if ln.len() == 2
                    && ln.starts_with('h')
                    && ln.as_bytes()[1] >= b'1'
                    && ln.as_bytes()[1] <= b'6'
                {
                    let text = reader.read_text(e.name()).ok()?;
                    let text = text.trim().to_string();
                    if !text.is_empty() {
                        return Some(text);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    None
}

fn resolve_relative_path(base: &str, relative: &str) -> String {
    let mut parts: Vec<&str> = base.split('/').collect();
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

fn sanitize_epub_html(html: &str, base_path: &str, hash: Option<&str>) -> String {
    use once_cell::sync::Lazy;
    static RE_SCRIPT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<script[^>]*>.*?</script>").unwrap());
    static RE_STYLE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<style[^>]*>.*?</style>").unwrap());
    static RE_HEAD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?si)<head[^>]*>.*?</head>").unwrap());
    static RE_IMG: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)<(?:img|image)[^>]*(?:src|href|xlink:href)=['"]([^'"]+)['"][^>]*>"#).unwrap());

    let mut text = RE_SCRIPT.replace_all(html, "").to_string();
    text = RE_STYLE.replace_all(&text, "").to_string();
    text = RE_HEAD.replace_all(&text, "").to_string();

    if let Some(h) = hash {
        text = RE_IMG.replace_all(&text, |caps: &regex::Captures| {
            let original_match = caps.get(0).unwrap().as_str();
            let src = caps.get(1).unwrap().as_str();
            if src.starts_with("data:") || src.starts_with("http") {
                return original_match.to_string();
            }
            let resolved = resolve_relative_path(base_path, src);
            let encoded = urlencoding::encode(&resolved);
            let new_src = format!("/api/local-book/epub/asset/{}?path={}", h, encoded);
            original_match.replace(src, &new_src)
        }).to_string();
    }
    
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

fn extract_nav_titles(nav: &str) -> Vec<String> {
    let mut titles = Vec::new();
    let mut reader = Reader::from_str(nav);
    let mut in_a = false;
    let mut current_title = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if local_name(e.name()) == "a" => {
                in_a = true;
                current_title.clear();
            }
            Ok(Event::End(ref e)) if local_name(e.name()) == "a" => {
                in_a = false;
                let trimmed = current_title.trim();
                if !trimmed.is_empty() {
                    titles.push(trimmed.to_string());
                }
            }
            Ok(Event::Text(ref e)) if in_a => {
                current_title.push_str(&e.unescape().unwrap_or_default());
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    titles
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
        let data = parse_epub(&bytes, None).expect("parse failed");
        assert_eq!(data.title, "Test Book");
        assert_eq!(data.author, "Test Author");
        assert_eq!(data.chapters.len(), 2);
    }

    #[test]
    fn parse_epub_chapter_content_not_empty() {
        let bytes = fixture_epub();
        let data = parse_epub(&bytes, None).unwrap();
        assert!(data.chapters[0].content.contains("Hello World"));
        assert!(data.chapters[1].content.contains("chapter two"));
    }

    #[test]
    fn validate_epub_accepts_epub_extension() {
        assert!(validate_epub_upload("book.epub", 100).is_ok());
    }

    #[test]
    fn validate_epub_rejects_txt_extension() {
        assert!(validate_epub_upload("book.txt", 100).is_err());
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
}

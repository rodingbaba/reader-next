use std::time::Duration;
use anyhow::Result;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverImageItem {
    pub url: String,
    pub thumb_url: String,
    pub title: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct BingImageMeta {
    #[serde(default)]
    murl: Option<String>,
    #[serde(default)]
    turl: Option<String>,
    #[serde(default)]
    t: Option<String>,
    #[serde(default)]
    desc: Option<String>,
    #[serde(default)]
    ow: Option<u32>,
    #[serde(default)]
    oh: Option<u32>,
}

pub fn parse_bing_image_html(html: &str) -> Vec<CoverImageItem> {
    let mut results = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();

    // 匹配 m="{...}" 或 m='{...}' 属性
    let re_attr = Regex::new(r#"(?s)\bm=(?:"([^"]+)"|'([^']+)')"#).unwrap();

    for cap in re_attr.captures_iter(html) {
        let raw_val = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str()).unwrap_or_default();
        if raw_val.is_empty() || (!raw_val.contains("murl") && !raw_val.contains("turl")) {
            continue;
        }

        let unescaped = raw_val
            .replace("&quot;", "\"")
            .replace("&amp;", "&")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">");

        if let Ok(meta) = serde_json::from_str::<BingImageMeta>(&unescaped) {
            let murl = meta.murl.unwrap_or_default().trim().to_string();
            let turl = meta.turl.unwrap_or_default().trim().to_string();
            let target_url = if !murl.is_empty() { murl.clone() } else { turl.clone() };

            if target_url.is_empty() || (!target_url.starts_with("http://") && !target_url.starts_with("https://")) {
                continue;
            }

            if seen_urls.contains(&target_url) {
                continue;
            }
            seen_urls.insert(target_url.clone());

            let display_thumb = if !turl.is_empty() { turl } else { target_url.clone() };
            let title = meta.t.or(meta.desc).unwrap_or_default().trim().to_string();

            results.push(CoverImageItem {
                url: target_url,
                thumb_url: display_thumb,
                title,
                width: meta.ow,
                height: meta.oh,
            });

            if results.len() >= 35 {
                break;
            }
        }
    }

    results
}

pub async fn search_bing_cover_images(keyword: &str) -> Result<Vec<CoverImageItem>> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Ok(Vec::new());
    }

    let encoded_kw = urlencoding::encode(kw);
    let target_url = format!(
        "https://www.bing.com/images/async?q={}&first=0&count=35&scenario=ImageBasicHover&datsrc=N_I&layout=ColumnBased&mmasync=1",
        encoded_kw
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()?;

    let resp = client
        .get(&target_url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await;

    match resp {
        Ok(res) => {
            if !res.status().is_success() {
                warn!("Bing image search returned HTTP status: {}", res.status());
                return Ok(Vec::new());
            }
            let html = res.text().await.unwrap_or_default();
            let items = parse_bing_image_html(&html);
            info!("Bing image search for '{}' returned {} results", kw, items.len());
            Ok(items)
        }
        Err(e) => {
            warn!("Failed to request Bing image search for '{}': {}", kw, e);
            Ok(Vec::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bing_image_html() {
        let sample_html = r#"
        <div class="imgpt">
            <a class="iusc" m="{&quot;cid&quot;:&quot;123&quot;,&quot;murl&quot;:&quot;https://example.com/cover1.jpg&quot;,&quot;turl&quot;:&quot;https://bing.com/th?id=123&quot;,&quot;t&quot;:&quot;《凡人修仙传》精美封面&quot;,&quot;ow&quot;:600,&quot;oh&quot;:800}">
                <img src="https://bing.com/th?id=123" />
            </a>
            <a class="iusc" m='{"cid":"456","murl":"https://example.com/cover2.png","turl":"https://bing.com/th?id=456","t":"凡人修仙传实体书海报","ow":480,"oh":640}'>
                <img src="https://bing.com/th?id=456" />
            </a>
        </div>
        "#;

        let results = parse_bing_image_html(sample_html);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://example.com/cover1.jpg");
        assert_eq!(results[0].thumb_url, "https://bing.com/th?id=123");
        assert_eq!(results[0].title, "《凡人修仙传》精美封面");
        assert_eq!(results[0].width, Some(600));
        assert_eq!(results[0].height, Some(800));

        assert_eq!(results[1].url, "https://example.com/cover2.png");
        assert_eq!(results[1].width, Some(480));
    }
}


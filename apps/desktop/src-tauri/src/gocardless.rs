use std::sync::Arc;

use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;

const KEYRING_SERVICE: &str = "tools.resonable.desktop";
const BASE_URL: &str = "https://bankaccountdata.gocardless.com/api/v2";
const ACCESS_REFRESH_BUFFER_SECS: i64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoCardlessCredentials {
    #[serde(rename = "secretId")]
    pub secret_id: String,
    #[serde(rename = "secretKey")]
    pub secret_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPair {
    pub access: String,
    #[serde(rename = "accessExpiresAt")]
    pub access_expires_at: String,
    pub refresh: String,
    #[serde(rename = "refreshExpiresAt")]
    pub refresh_expires_at: String,
}

#[derive(Debug, Deserialize)]
struct GcTokenNewResponse {
    access: String,
    access_expires: i64,
    refresh: String,
    refresh_expires: i64,
}

#[derive(Debug, Deserialize)]
struct GcTokenRefreshResponse {
    access: String,
    access_expires: i64,
}

#[derive(Debug, Deserialize)]
struct GcInstitution {
    id: String,
    name: String,
    #[serde(default)]
    logo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Institution {
    pub id: String,
    pub name: String,
    pub logo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RequisitionCreated {
    pub id: String,
    pub link: String,
}

#[derive(Debug, Deserialize)]
struct GcRequisitionCreateResp {
    id: String,
    link: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequisitionStatus {
    pub status: String,
    pub accounts: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GcRequisitionGetResp {
    #[serde(default)]
    status: serde_json::Value,
    #[serde(default)]
    accounts: Vec<String>,
}

pub struct GoCardlessState {
    pub client: Client,
    pub lock: Arc<Mutex<()>>,
}

impl GoCardlessState {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder()
            .user_agent("resonable-desktop/0.0.0")
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;
        Ok(Self {
            client,
            lock: Arc::new(Mutex::new(())),
        })
    }
}

fn token_cache_key(connection_id: &str) -> String {
    format!("{connection_id}.tokens")
}

fn token_entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &token_cache_key(connection_id))
        .map_err(|e| format!("keyring entry: {e}"))
}

fn read_cached(connection_id: &str) -> Result<Option<TokenPair>, String> {
    match token_entry(connection_id)?.get_password() {
        Ok(json) => serde_json::from_str::<TokenPair>(&json)
            .map(Some)
            .map_err(|e| format!("cached tokens parse: {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(other) => Err(format!("keyring get tokens: {other}")),
    }
}

fn write_cached(connection_id: &str, tokens: &TokenPair) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    token_entry(connection_id)?
        .set_password(&json)
        .map_err(|e| format!("keyring set tokens: {e}"))
}

fn now() -> OffsetDateTime {
    OffsetDateTime::now_utc()
}

fn iso(t: OffsetDateTime) -> Result<String, String> {
    t.format(&Rfc3339).map_err(|e| e.to_string())
}

fn parse_iso(s: &str) -> Result<OffsetDateTime, String> {
    OffsetDateTime::parse(s, &Rfc3339).map_err(|e| format!("parse iso {s}: {e}"))
}

fn access_still_valid(tokens: &TokenPair) -> bool {
    match parse_iso(&tokens.access_expires_at) {
        Ok(expires) => expires - now() > Duration::seconds(ACCESS_REFRESH_BUFFER_SECS),
        Err(_) => false,
    }
}

fn refresh_still_valid(tokens: &TokenPair) -> bool {
    match parse_iso(&tokens.refresh_expires_at) {
        Ok(expires) => expires > now(),
        Err(_) => false,
    }
}

async fn mint_new(client: &Client, creds: &GoCardlessCredentials) -> Result<TokenPair, String> {
    let resp = client
        .post(format!("{BASE_URL}/token/new/"))
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "secret_id": creds.secret_id,
            "secret_key": creds.secret_key,
        }))
        .send()
        .await
        .map_err(|e| format!("gc token/new: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gc token/new {status}: {body}"));
    }
    let parsed: GcTokenNewResponse = resp.json().await.map_err(|e| format!("token/new json: {e}"))?;
    let now_ts = now();
    Ok(TokenPair {
        access: parsed.access,
        access_expires_at: iso(now_ts + Duration::seconds(parsed.access_expires))?,
        refresh: parsed.refresh,
        refresh_expires_at: iso(now_ts + Duration::seconds(parsed.refresh_expires))?,
    })
}

async fn refresh_access(
    client: &Client,
    tokens: &TokenPair,
) -> Result<TokenPair, String> {
    let resp = client
        .post(format!("{BASE_URL}/token/refresh/"))
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "refresh": tokens.refresh }))
        .send()
        .await
        .map_err(|e| format!("gc token/refresh: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gc token/refresh {status}: {body}"));
    }
    let parsed: GcTokenRefreshResponse = resp
        .json()
        .await
        .map_err(|e| format!("token/refresh json: {e}"))?;
    let now_ts = now();
    Ok(TokenPair {
        access: parsed.access,
        access_expires_at: iso(now_ts + Duration::seconds(parsed.access_expires))?,
        refresh: tokens.refresh.clone(),
        refresh_expires_at: tokens.refresh_expires_at.clone(),
    })
}

async fn ensure_tokens_inner(
    client: &Client,
    connection_id: &str,
    creds: &GoCardlessCredentials,
) -> Result<TokenPair, String> {
    if let Some(cached) = read_cached(connection_id)? {
        if access_still_valid(&cached) {
            return Ok(cached);
        }
        if refresh_still_valid(&cached) {
            match refresh_access(client, &cached).await {
                Ok(refreshed) => {
                    write_cached(connection_id, &refreshed)?;
                    return Ok(refreshed);
                }
                Err(_) => {
                    // fall through to minting a new pair
                }
            }
        }
    }
    let fresh = mint_new(client, creds).await?;
    write_cached(connection_id, &fresh)?;
    Ok(fresh)
}

#[tauri::command]
pub async fn gc_ensure_tokens(
    state: tauri::State<'_, GoCardlessState>,
    connection_id: String,
    creds: GoCardlessCredentials,
) -> Result<TokenPair, String> {
    let _guard = state.lock.lock().await;
    ensure_tokens_inner(&state.client, &connection_id, &creds).await
}

async fn authed_get(
    client: &Client,
    access: &str,
    url: String,
) -> Result<reqwest::Response, String> {
    client
        .get(&url)
        .bearer_auth(access)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))
}

#[tauri::command]
pub async fn gc_list_institutions(
    state: tauri::State<'_, GoCardlessState>,
    connection_id: String,
    country: String,
) -> Result<Vec<Institution>, String> {
    let tokens = {
        let _guard = state.lock.lock().await;
        read_cached(&connection_id)?
            .ok_or_else(|| "no cached tokens; call gc_ensure_tokens first".to_string())?
    };
    let url = format!("{BASE_URL}/institutions/?country={country}");
    let resp = authed_get(&state.client, &tokens.access, url).await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gc institutions {status}: {body}"));
    }
    let raw: Vec<GcInstitution> = resp
        .json()
        .await
        .map_err(|e| format!("institutions json: {e}"))?;
    Ok(raw
        .into_iter()
        .map(|i| Institution {
            id: i.id,
            name: i.name,
            logo: i.logo,
        })
        .collect())
}

#[tauri::command]
pub async fn gc_create_requisition(
    state: tauri::State<'_, GoCardlessState>,
    connection_id: String,
    institution_id: String,
    redirect_url: String,
    reference: Option<String>,
) -> Result<RequisitionCreated, String> {
    let tokens = {
        let _guard = state.lock.lock().await;
        read_cached(&connection_id)?
            .ok_or_else(|| "no cached tokens; call gc_ensure_tokens first".to_string())?
    };
    let mut body = serde_json::json!({
        "institution_id": institution_id,
        "redirect": redirect_url,
    });
    if let Some(r) = reference {
        body["reference"] = serde_json::Value::String(r);
    }
    let resp = state
        .client
        .post(format!("{BASE_URL}/requisitions/"))
        .bearer_auth(&tokens.access)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("POST requisitions: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gc create requisition {status}: {body}"));
    }
    let parsed: GcRequisitionCreateResp = resp
        .json()
        .await
        .map_err(|e| format!("requisition create json: {e}"))?;
    Ok(RequisitionCreated {
        id: parsed.id,
        link: parsed.link,
    })
}

#[tauri::command]
pub async fn gc_get_requisition(
    state: tauri::State<'_, GoCardlessState>,
    connection_id: String,
    requisition_id: String,
) -> Result<RequisitionStatus, String> {
    let tokens = {
        let _guard = state.lock.lock().await;
        read_cached(&connection_id)?
            .ok_or_else(|| "no cached tokens; call gc_ensure_tokens first".to_string())?
    };
    let url = format!("{BASE_URL}/requisitions/{requisition_id}/");
    let resp = authed_get(&state.client, &tokens.access, url).await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gc get requisition {status}: {body}"));
    }
    let parsed: GcRequisitionGetResp = resp
        .json()
        .await
        .map_err(|e| format!("requisition get json: {e}"))?;
    let status = match parsed.status {
        serde_json::Value::String(s) => s,
        serde_json::Value::Object(o) => o
            .get("short")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default(),
        other => other.to_string(),
    };
    Ok(RequisitionStatus {
        status,
        accounts: parsed.accounts,
    })
}

#[tauri::command]
pub async fn gc_list_transactions(
    state: tauri::State<'_, GoCardlessState>,
    connection_id: String,
    account_id: String,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<serde_json::Value, String> {
    let tokens = {
        let _guard = state.lock.lock().await;
        read_cached(&connection_id)?
            .ok_or_else(|| "no cached tokens; call gc_ensure_tokens first".to_string())?
    };
    let mut url = format!("{BASE_URL}/accounts/{account_id}/transactions/");
    let mut qs: Vec<(String, String)> = Vec::new();
    if let Some(f) = date_from {
        qs.push(("date_from".to_string(), f));
    }
    if let Some(t) = date_to {
        qs.push(("date_to".to_string(), t));
    }
    if !qs.is_empty() {
        let joined = qs
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&");
        url.push('?');
        url.push_str(&joined);
    }
    let resp = authed_get(&state.client, &tokens.access, url).await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gc list transactions {status}: {body}"));
    }
    let value: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("transactions json: {e}"))?;
    Ok(value)
}

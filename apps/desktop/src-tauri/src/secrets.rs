use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "tools.resonable.desktop";
const INDEX_FILENAME: &str = "secrets-index.json";

/// Index file persisted to `app_local_data_dir()`. keyring has no enumerate API,
/// so we keep a small plaintext list of which keys exist (values stay in the
/// OS keychain).
#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretIndex {
    keys: BTreeSet<String>,
}

pub struct SecretsState {
    index_path: Mutex<Option<PathBuf>>,
}

impl SecretsState {
    pub fn new() -> Self {
        Self {
            index_path: Mutex::new(None),
        }
    }

    fn resolve_index_path(&self, app: &AppHandle) -> Result<PathBuf, String> {
        let mut cache = self.index_path.lock().map_err(|e| e.to_string())?;
        if let Some(p) = cache.as_ref() {
            return Ok(p.clone());
        }
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("app_local_data_dir: {e}"))?;
        fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
        let full = dir.join(INDEX_FILENAME);
        *cache = Some(full.clone());
        Ok(full)
    }

    fn load_index(path: &Path) -> SecretIndex {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SecretIndex>(&bytes).ok())
            .unwrap_or_default()
    }

    fn save_index(path: &Path, index: &SecretIndex) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, bytes).map_err(|e| e.to_string())
    }
}

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("keyring entry: {e}"))
}

#[tauri::command]
pub async fn secrets_get(key: String) -> Result<Option<String>, String> {
    let e = entry(&key)?;
    match e.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(other) => Err(format!("keyring get: {other}")),
    }
}

#[tauri::command]
pub async fn secrets_set(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    key: String,
    value: String,
) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|e| format!("keyring set: {e}"))?;
    let index_path = state.resolve_index_path(&app)?;
    let mut idx = SecretsState::load_index(&index_path);
    idx.keys.insert(key);
    SecretsState::save_index(&index_path, &idx)?;
    Ok(())
}

#[tauri::command]
pub async fn secrets_delete(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    key: String,
) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(other) => return Err(format!("keyring delete: {other}")),
    }
    let index_path = state.resolve_index_path(&app)?;
    let mut idx = SecretsState::load_index(&index_path);
    idx.keys.remove(&key);
    SecretsState::save_index(&index_path, &idx)?;
    Ok(())
}

#[tauri::command]
pub async fn secrets_list(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    prefix: String,
) -> Result<Vec<String>, String> {
    let index_path = state.resolve_index_path(&app)?;
    let idx = SecretsState::load_index(&index_path);
    Ok(idx
        .keys
        .into_iter()
        .filter(|k| k.starts_with(&prefix))
        .collect())
}

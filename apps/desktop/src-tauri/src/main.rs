// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod gocardless;
mod secrets;

use gocardless::GoCardlessState;
use secrets::SecretsState;

fn main() {
    let gc_state = GoCardlessState::new().expect("init gocardless state");
    tauri::Builder::default()
        .manage(SecretsState::new())
        .manage(gc_state)
        .invoke_handler(tauri::generate_handler![
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_list,
            gocardless::gc_ensure_tokens,
            gocardless::gc_list_institutions,
            gocardless::gc_create_requisition,
            gocardless::gc_get_requisition,
            gocardless::gc_list_transactions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running resonable desktop");
}

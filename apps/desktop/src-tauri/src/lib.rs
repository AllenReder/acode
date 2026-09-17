use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Runtime, Url};

const PRIMARY_LOCAL_ENVIRONMENT_ID: &str = "primary";
const DEFAULT_ENVIRONMENT_LABEL: &str = "ACode local daemon";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedServerRuntimeState {
    version: u8,
    pid: i64,
    origin: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEnvironmentBootstrap {
    id: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ws_base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bootstrap_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeConfig {
    bootstraps: Vec<DesktopEnvironmentBootstrap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bearer_token: Option<String>,
    client_platform: String,
}

fn read_non_empty_env(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    })
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn runtime_state_candidates() -> Vec<PathBuf> {
    if let Some(path) =
        read_non_empty_env(&["ACODE_DESKTOP_RUNTIME_PATH", "T3CODE_DESKTOP_RUNTIME_PATH"])
    {
        return vec![PathBuf::from(path)];
    }

    let mut bases = Vec::new();
    if let Some(base) = read_non_empty_env(&["ACODE_HOME", "T3CODE_HOME"]) {
        push_unique(&mut bases, PathBuf::from(base));
    }

    if let Ok(mut current) = env::current_dir() {
        // The wrapper normally provides ACODE_HOME. These ancestors keep the
        // shell usable when the Tauri CLI is invoked directly from this repo.
        for _ in 0..=3 {
            push_unique(&mut bases, current.join(".acode"));
            if !current.pop() {
                break;
            }
        }
    }

    if let Some(home) = read_non_empty_env(&["HOME", "USERPROFILE"]) {
        push_unique(&mut bases, PathBuf::from(home).join(".acode"));
    }

    bases
        .into_iter()
        .flat_map(|base| {
            [
                base.join("userdata/server-runtime.json"),
                base.join("dev/server-runtime.json"),
            ]
        })
        .collect()
}

fn is_process_alive(pid: i64) -> bool {
    if pid <= 0 {
        return false;
    }

    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
        return result == 0
            || (result == -1
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM));
    }

    #[cfg(not(unix))]
    {
        // The endpoint and descriptor are still verified by the client. The
        // cross-platform shell does not introduce a process-management API in
        // this ticket; later daemon supervision owns that concern.
        let _ = pid;
        true
    }
}

fn read_runtime_state() -> Result<Option<PersistedServerRuntimeState>, String> {
    for path in runtime_state_candidates() {
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!("Unable to read {}: {error}", path.display()));
            }
        };

        let state: PersistedServerRuntimeState = serde_json::from_str(&contents)
            .map_err(|error| format!("Unable to decode {}: {error}", path.display()))?;
        if state.version != 1 {
            return Err(format!(
                "Unsupported server runtime state version {} in {}.",
                state.version,
                path.display()
            ));
        }
        if is_process_alive(state.pid) {
            return Ok(Some(state));
        }
    }

    Ok(None)
}

fn normalize_local_origin(raw: &str, expected_schemes: &[&str]) -> Result<String, String> {
    let mut url = Url::parse(raw).map_err(|error| format!("Invalid daemon URL: {error}"))?;
    if !expected_schemes.contains(&url.scheme()) {
        return Err(format!("Unsupported daemon URL scheme: {}", url.scheme()));
    }
    if url.username() != "" || url.password().is_some() {
        return Err("Daemon URLs cannot contain credentials.".to_owned());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Daemon URL must include a host.".to_owned())?;
    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if !is_loopback {
        return Err(format!(
            "The Tauri shell only accepts loopback daemons; got {host}."
        ));
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

fn websocket_origin_from_http(http_origin: &str) -> Result<String, String> {
    let mut url = Url::parse(http_origin).map_err(|error| error.to_string())?;
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        other => return Err(format!("Cannot derive a WebSocket URL from {other}.")),
    };
    url.set_scheme(scheme)
        .map_err(|_| "Unable to set the WebSocket URL scheme.".to_owned())?;
    Ok(url.to_string())
}

fn http_origin_from_websocket(ws_origin: &str) -> Result<String, String> {
    let mut url = Url::parse(ws_origin).map_err(|error| error.to_string())?;
    let scheme = match url.scheme() {
        "ws" => "http",
        "wss" => "https",
        other => return Err(format!("Cannot derive an HTTP URL from {other}.")),
    };
    url.set_scheme(scheme)
        .map_err(|_| "Unable to set the HTTP URL scheme.".to_owned())?;
    Ok(url.to_string())
}

fn resolve_daemon_origins(
    runtime: Option<&PersistedServerRuntimeState>,
) -> Result<Option<(String, String)>, String> {
    let explicit_http = read_non_empty_env(&["ACODE_DESKTOP_HTTP_URL", "T3CODE_DESKTOP_HTTP_URL"]);
    let explicit_ws = read_non_empty_env(&["ACODE_DESKTOP_WS_URL", "T3CODE_DESKTOP_WS_URL"]);

    let http_raw = explicit_http.or_else(|| runtime.map(|state| state.origin.clone()));
    let ws_raw = explicit_ws;
    if http_raw.is_none() && ws_raw.is_none() {
        return Ok(None);
    }

    let http_origin = match http_raw {
        Some(raw) => normalize_local_origin(&raw, &["http", "https"])?,
        None => {
            let raw = ws_raw
                .as_deref()
                .ok_or_else(|| "Missing the daemon HTTP URL.".to_owned())?;
            let derived = http_origin_from_websocket(raw)?;
            normalize_local_origin(&derived, &["http", "https"])?
        }
    };
    let ws_origin = match ws_raw {
        Some(raw) => normalize_local_origin(&raw, &["ws", "wss"])?,
        None => websocket_origin_from_http(&http_origin)?,
    };

    Ok(Some((http_origin, ws_origin)))
}

fn client_platform() -> String {
    #[cfg(target_os = "macos")]
    return "darwin".to_owned();
    #[cfg(target_os = "windows")]
    return "win32".to_owned();
    #[cfg(target_os = "linux")]
    return "linux".to_owned();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "other".to_owned();
}

#[tauri::command]
fn read_desktop_runtime_config() -> Result<DesktopRuntimeConfig, String> {
    let runtime = read_runtime_state()?;
    let origins = resolve_daemon_origins(runtime.as_ref())?;
    let bearer_token =
        read_non_empty_env(&["ACODE_DESKTOP_BEARER_TOKEN", "T3CODE_DESKTOP_BEARER_TOKEN"]);
    let bootstrap_token = if bearer_token.is_none() {
        read_non_empty_env(&[
            "ACODE_DESKTOP_BOOTSTRAP_TOKEN",
            "T3CODE_DESKTOP_BOOTSTRAP_TOKEN",
        ])
    } else {
        None
    };

    let bootstraps = origins
        .map(|(http_base_url, ws_base_url)| {
            vec![DesktopEnvironmentBootstrap {
                id: PRIMARY_LOCAL_ENVIRONMENT_ID.to_owned(),
                label: read_non_empty_env(&["ACODE_DESKTOP_LABEL"])
                    .unwrap_or_else(|| DEFAULT_ENVIRONMENT_LABEL.to_owned()),
                http_base_url: Some(http_base_url),
                ws_base_url: Some(ws_base_url),
                bootstrap_token,
            }]
        })
        .unwrap_or_default();

    Ok(DesktopRuntimeConfig {
        bootstraps,
        bearer_token,
        client_platform: client_platform(),
    })
}

fn allow_app_navigation(url: &Url) -> bool {
    if (url.scheme() == "http" || url.scheme() == "https")
        && url.host_str() == Some("tauri.localhost")
    {
        return true;
    }
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") {
        return true;
    }

    cfg!(debug_assertions)
        && (url.scheme() == "http" || url.scheme() == "https")
        && url.host_str() == Some("localhost")
}

fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("acode-navigation-guard")
        .on_navigation(|_, url| allow_app_navigation(url))
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_desktop_runtime_config])
        .run(tauri::generate_context!())
        .expect("error while running ACode desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_loopback_http_origins_and_drops_paths() {
        assert_eq!(
            normalize_local_origin("http://localhost:13773/api?debug=1", &["http"])
                .expect("valid loopback origin"),
            "http://localhost:13773/"
        );
    }

    #[test]
    fn rejects_non_loopback_daemons() {
        let error = normalize_local_origin("http://example.test:13773", &["http"])
            .expect_err("remote origin must not be accepted by this shell");
        assert!(error.contains("loopback"));
    }

    #[test]
    fn derives_websocket_origin_from_http_origin() {
        assert_eq!(
            websocket_origin_from_http("http://127.0.0.1:3773/").expect("valid HTTP origin"),
            "ws://127.0.0.1:3773/"
        );
    }

    #[test]
    fn navigation_guard_only_allows_app_and_debug_localhost_origins() {
        assert!(allow_app_navigation(
            &Url::parse("http://tauri.localhost/").expect("app origin")
        ));
        assert!(!allow_app_navigation(
            &Url::parse("https://example.test/").expect("external origin")
        ));
    }
}

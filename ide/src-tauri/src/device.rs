use crate::Result;
use serde::Serialize;
use std::{
    env,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub(crate) struct DeviceLogs(Mutex<Option<Child>>);

#[derive(Serialize)]
pub(crate) struct UsbStatus {
    count: usize,
    version: Option<String>,
    model: Option<String>,
}

fn devices() -> Result<Vec<String>> {
    let result = Command::new("idevice_id").arg("-l").output()
        .map_err(|error| format!("Install libimobiledevice-utils to detect USB devices: {error}"))?;
    Ok(String::from_utf8_lossy(&result.stdout).lines().map(str::trim).filter(|id| {
        !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    }).map(str::to_owned).collect())
}

fn info(id: &str, key: &str) -> Option<String> {
    let result = Command::new("ideviceinfo").args(["-u", id, "-k", key]).output().ok()?;
    if !result.status.success() { return None; }
    let value = String::from_utf8_lossy(&result.stdout).trim().to_owned();
    (!value.is_empty()).then_some(value)
}

#[tauri::command]
pub(crate) async fn usb_status() -> Result<UsbStatus> {
    tauri::async_runtime::spawn_blocking(|| {
        let ids = devices()?;
        let selected = if ids.len() == 1 { ids.first() } else { None };
        Ok(UsbStatus {
            count: ids.len(),
            model: selected.and_then(|id| info(id, "ProductType")),
            version: selected.and_then(|id| info(id, "ProductVersion")),
        })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn open_iloader() -> Result<()> {
    let binary = env::var_os("SWIFTFORGE_ILOADER").unwrap_or_else(|| "iloader".into());
    let mut child = Command::new(binary).spawn()
        .map_err(|error| format!("Cannot open iLoader. Set SWIFTFORGE_ILOADER or install it in PATH: {error}"))?;
    thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

#[tauri::command]
pub(crate) fn device_logs_start(logs: State<'_, DeviceLogs>, process: &str, output: Channel<String>) -> Result<()> {
    if process.is_empty() || process.len() > 100 || !process.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b' ')
    }) {
        return Err("Enter a valid app executable name.".into());
    }
    let ids = devices()?;
    let [device] = ids.as_slice() else { return Err("Connect exactly one iPhone over USB for device logs.".into()); };
    device_logs_stop(logs.clone())?;
    let mut child = crate::mirror::child_command("idevicesyslog")
        .args(["-u", device, "--no-colors", "--exit", "-p", process])
        .stdin(Stdio::null()).stdout(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    let stream = child.stdout.take().expect("device log output is piped");
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(std::io::Result::ok) {
            if line.starts_with("[connected:") || line.starts_with("[disconnected:") { continue; }
            if output.send(line).is_err() { return; }
        }
        let _ = output.send("Device log stream ended.".into());
    });
    *logs.0.lock().map_err(|error| error.to_string())? = Some(child);
    Ok(())
}

#[tauri::command]
pub(crate) fn device_logs_stop(logs: State<'_, DeviceLogs>) -> Result<()> {
    if let Some(mut child) = logs.0.lock().map_err(|error| error.to_string())?.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

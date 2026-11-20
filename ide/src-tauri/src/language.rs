use crate::{active_root, Result, Workspace};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub(crate) struct Language(Mutex<Option<Session>>);

struct Session {
    child: Child,
    input: ChildStdin,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) fn prepare_bsp(root: &Path) -> Result<()> {
    if !root.join("xtool.yml").is_file() {
        return Ok(());
    }
    let directory = root.join(".bsp");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("xtool.json");
    if !path.exists() {
        let data = json!({
            "name": "xtool", "version": "1.0", "bspVersion": "2.2.0",
            "languages": ["c", "cpp", "objective-c", "objective-cpp", "swift"],
            "argv": ["/usr/bin/env", "xtool", "dev", "build-server"]
        });
        fs::write(path, serde_json::to_vec_pretty(&data).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn forward(output: impl Read, messages: Channel<Value>) -> std::io::Result<()> {
    let mut reader = BufReader::new(output);
    loop {
        let mut length = None;
        let mut header = String::new();
        loop {
            header.clear();
            if reader.by_ref().take(1024).read_line(&mut header)? == 0 {
                return Ok(());
            }
            if header.trim().is_empty() { break; }
            if let Some(value) = header.trim().strip_prefix("Content-Length:") {
                length = value.trim().parse::<usize>().ok();
            }
        }
        let size = length.filter(|value| *value <= 16 * 1024 * 1024)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid language server frame"))?;
        let mut frame = vec![0; size];
        reader.read_exact(&mut frame)?;
        let message: Value = serde_json::from_slice(&frame)?;
        if messages.send(message).is_err() { return Ok(()); }
    }
}

#[tauri::command]
pub(crate) fn language_start(workspace: State<'_, Workspace>, language: State<'_, Language>, root: &str, messages: Channel<Value>) -> Result<()> {
    let root = {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        active_root(&state, root)?.to_owned()
    };
    prepare_bsp(&root)?;
    let mut session = language.0.lock().map_err(|error| error.to_string())?;
    session.take();
    let mut child = Command::new("sourcekit-lsp").current_dir(root)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit())
        .spawn().map_err(|error| format!("Cannot start SourceKit-LSP: {error}"))?;
    let input = child.stdin.take().expect("SourceKit input is piped");
    let output = child.stdout.take().expect("SourceKit output is piped");
    thread::spawn(move || {
        if let Err(error) = forward(output, messages.clone()) {
            eprintln!("SourceKit-LSP: {error}");
        }
        let _ = messages.send(json!({ "method": "swiftforge/serverStopped" }));
    });
    *session = Some(Session { child, input });
    Ok(())
}

#[tauri::command]
pub(crate) fn language_send(language: State<'_, Language>, message: Value) -> Result<()> {
    let data = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
    let mut session = language.0.lock().map_err(|error| error.to_string())?;
    let input = &mut session.as_mut().ok_or("SourceKit-LSP is stopped.")?.input;
    write!(input, "Content-Length: {}\r\n\r\n", data.len()).and_then(|_| input.write_all(&data))
        .and_then(|_| input.flush()).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn language_stop(language: State<'_, Language>) -> Result<()> {
    language.0.lock().map_err(|error| error.to_string())?.take();
    Ok(())
}

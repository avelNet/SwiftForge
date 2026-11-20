use crate::{active_root, Result, Workspace};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{env, io::{Read, Write}, sync::Mutex, thread};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub(crate) struct Terminal(Mutex<Option<Session>>);

struct Session {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    input: Box<dyn Write + Send>,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Clone, Serialize)]
pub(crate) struct TerminalEvent {
    bytes: Option<String>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
pub(crate) fn terminal_start(workspace: State<'_, Workspace>, terminal: State<'_, Terminal>, root: &str, cols: u16, rows: u16, output: Channel<TerminalEvent>) -> Result<()> {
    let root = {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        active_root(&state, root)?.to_owned()
    };
    let mut active = terminal.0.lock().map_err(|error| error.to_string())?;
    active.take();
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|error| error.to_string())?;
    let mut command = CommandBuilder::new(env::var_os("SHELL").unwrap_or_else(|| "/bin/bash".into()));
    command.cwd(root);
    command.env("TERM", "xterm-256color");
    let input = pair.master.take_writer().map_err(|error| error.to_string())?;
    let mut stream = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
    drop(pair.slave);
    *active = Some(Session { child, master: pair.master, input });

    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while let Ok(length) = stream.read(&mut buffer) {
            if length == 0 { break; }
            if output.send(TerminalEvent { bytes: Some(STANDARD.encode(&buffer[..length])) }).is_err() { return; }
        }
        let _ = output.send(TerminalEvent { bytes: None });
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn terminal_input(terminal: State<'_, Terminal>, text: &str) -> Result<()> {
    let mut terminal = terminal.0.lock().map_err(|error| error.to_string())?;
    let input = &mut terminal.as_mut().ok_or("No terminal is running.")?.input;
    input.write_all(text.as_bytes()).and_then(|_| input.flush()).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn terminal_resize(terminal: State<'_, Terminal>, cols: u16, rows: u16) -> Result<()> {
    if let Some(session) = terminal.0.lock().map_err(|error| error.to_string())?.as_ref() {
        session.master.resize(size(cols, rows)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn terminal_stop(terminal: State<'_, Terminal>) -> Result<()> {
    terminal.0.lock().map_err(|error| error.to_string())?.take();
    Ok(())
}

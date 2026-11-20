use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

mod build;
mod mirror;
use tauri_plugin_dialog::DialogExt;

const TEXT_LIMIT: usize = 2 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
type Workspace = Mutex<Option<PathBuf>>;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    directory: bool,
}

#[tauri::command]
async fn open_workspace(app: AppHandle, workspace: State<'_, Workspace>) -> Result<Option<String>> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let root = folder.into_path().map_err(|error| error.to_string())?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let name = root
        .to_str()
        .ok_or("The project path must be valid UTF-8.")?
        .to_owned();
    *workspace.lock().map_err(|error| error.to_string())? = Some(root);
    Ok(Some(name))
}

fn workspace_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("The requested path is outside the workspace.".into());
        };
        target.push(name);
        let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
        if metadata.is_symlink() {
            return Err("Symbolic links cannot be opened as workspace files.".into());
        }
    }
    let canonical = target.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("The requested path is outside the workspace.".into());
    }
    Ok(canonical)
}

fn active_root<'a>(workspace: &'a Option<PathBuf>, expected: &str) -> Result<&'a Path> {
    let root = workspace.as_deref().ok_or("Open a project first.")?;
    if root != Path::new(expected) {
        return Err("The active project has changed.".into());
    }
    Ok(root)
}

#[tauri::command]
fn list_directory(workspace: State<'_, Workspace>, root: &str, path: &str) -> Result<Vec<Entry>> {
    let state = workspace.lock().map_err(|error| error.to_string())?;
    let directory = workspace_path(active_root(&state, root)?, path)?;
    let mut entries = Vec::new();
    for child in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let child = child.map_err(|error| error.to_string())?;
        let Ok(name) = child.file_name().into_string() else {
            continue;
        };
        let kind = child.file_type().map_err(|error| error.to_string())?;
        if name.starts_with('.') || name == "node_modules" || !kind.is_dir() && !kind.is_file() {
            continue;
        }
        entries.push(Entry {
            path: if path.is_empty() { name.clone() } else { format!("{path}/{name}") },
            name,
            directory: kind.is_dir(),
        });
    }
    entries.sort_by(|left, right| {
        right.directory.cmp(&left.directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

fn load_text(path: &Path) -> Result<String> {
    if !path.is_file() {
        return Err("Select a project file.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(TEXT_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > TEXT_LIMIT || bytes.contains(&0) {
        return Err("Open a UTF-8 text file no larger than 2 MiB.".into());
    }
    String::from_utf8(bytes).map_err(|_| "The file is not valid UTF-8.".into())
}

#[tauri::command]
fn read_document(workspace: State<'_, Workspace>, root: &str, path: &str) -> Result<String> {
    let state = workspace.lock().map_err(|error| error.to_string())?;
    let path = workspace_path(active_root(&state, root)?, path)?;
    load_text(&path)
}

#[tauri::command]
fn save_document(
    workspace: State<'_, Workspace>,
    root: &str,
    path: &str,
    text: &str,
    previous: &str,
) -> Result<()> {
    if text.len() > TEXT_LIMIT || text.contains('\0') {
        return Err("The text exceeds the supported file limits.".into());
    }
    let state = workspace.lock().map_err(|error| error.to_string())?;
    let path = workspace_path(active_root(&state, root)?, path)?;
    if load_text(&path)? != previous {
        return Err("The file changed on disk. Copy your edits before reopening it.".into());
    }
    let parent = path.parent().ok_or("The file has no parent directory.")?;
    let permissions = fs::metadata(&path).map_err(|error| error.to_string())?.permissions();
    let mut next = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    next.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
    next.as_file().set_permissions(permissions).map_err(|error| error.to_string())?;
    next.as_file().sync_all().map_err(|error| error.to_string())?;
    next.persist(&path).map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Workspace::default())
        .manage(build::Build::default())
        .manage(mirror::Mirror::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            list_directory,
            read_document,
            save_document,
            build::create_project,
            build::choose_directory,
            build::build_project,
            build::cancel_build,
            build::export_ipa,
            build::toolchain_status,
            mirror::mirror_start,
            mirror::mirror_next,
            mirror::mirror_stop
        ])
        .build(tauri::generate_context!())
        .expect("SwiftForge could not start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let _ = mirror::mirror_stop(app.state());
                let _ = build::cancel_build(app.state());
            }
        });
}

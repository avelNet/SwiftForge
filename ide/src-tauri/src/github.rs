use crate::{active_root, build::path_text, Result, Workspace};
use std::{path::{Path, PathBuf}, process::Command};
use tauri::State;

fn github_repo(value: &str) -> Option<(&str, &str)> {
    let value = value.trim();
    let slug = value.strip_prefix("https://github.com/")
        .or_else(|| value.strip_prefix("git@github.com:"))
        .unwrap_or(value)
        .trim_end_matches('/');
    let slug = slug.strip_suffix(".git").unwrap_or(slug);
    let (owner, repo) = slug.split_once('/')?;
    let valid = |part: &str| !part.is_empty() && part.len() <= 100 && part != "." && part != ".."
        && part.bytes().all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_' | b'.'));
    (valid(owner) && valid(repo)).then_some((owner, repo))
}

fn execute(args: &[&str], root: &Path) -> Result<String> {
    let output = Command::new("git").args(args).current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0").output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_owned())
}

#[tauri::command]
pub(crate) async fn github_clone(workspace: State<'_, Workspace>, repository: String, parent: String) -> Result<String> {
    let (owner, repo) = github_repo(&repository).ok_or("Enter a GitHub URL or owner/repository.")?;
    let url = format!("https://github.com/{owner}/{repo}.git");
    let name = repo.to_owned();
    let root = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf> {
        let parent = PathBuf::from(parent).canonicalize().map_err(|error| error.to_string())?;
        let root = parent.join(&name);
        if root.exists() { return Err(format!("{} already exists. Open it as a folder.", root.display())); }
        execute(&["clone", "--", &url, &name], &parent)?;
        root.canonicalize().map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())??;
    let path = path_text(&root)?;
    *workspace.lock().map_err(|error| error.to_string())? = Some(root);
    Ok(path)
}

#[tauri::command]
pub(crate) async fn github_status(workspace: State<'_, Workspace>, root: String) -> Result<String> {
    let root = {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        active_root(&state, &root)?.to_owned()
    };
    tauri::async_runtime::spawn_blocking(move || execute(&["status", "--short", "--branch"], &root))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn github_open(workspace: State<'_, Workspace>, root: &str) -> Result<()> {
    let root = {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        active_root(&state, root)?.to_owned()
    };
    let remote = execute(&["remote", "get-url", "origin"], &root)?;
    let (owner, repo) = github_repo(&remote).ok_or("The origin remote does not point to GitHub.")?;
    Command::new("xdg-open").arg(format!("https://github.com/{owner}/{repo}")).spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub(crate) struct GitChange {
    path: String,
    status: String,
}

#[derive(serde::Serialize)]
pub(crate) struct GitOverview {
    branch: String,
    changes: Vec<GitChange>,
}

#[tauri::command]
pub(crate) async fn github_overview(workspace: State<'_, Workspace>, root: String) -> Result<GitOverview> {
    let root = {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        active_root(&state, &root)?.to_owned()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let prefix = execute(&["rev-parse", "--show-prefix"], &root)?;
        let data = execute(&["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all", "--", "."], &root)?;
        let mut records = data.split('\0');
        let branch = records.next().and_then(|line| line.strip_prefix("## "))
            .unwrap_or("Detached HEAD").to_owned();
        let mut changes = Vec::new();
        while let Some(record) = records.next() {
            let Some((status, path)) = record.split_at_checked(3) else { continue };
            let status = status.trim().to_owned();
            if status.contains(['R', 'C']) { records.next(); }
            if let Some(path) = path.strip_prefix(&prefix) {
                changes.push(GitChange { path: path.to_owned(), status });
            }
        }
        Ok(GitOverview { branch, changes })
    }).await.map_err(|error| error.to_string())?
}

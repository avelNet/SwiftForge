use crate::{active_root, Result, Workspace};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub(crate) struct Build(Mutex<Option<Arc<AtomicBool>>>);

const MANIFEST: &str = r#"// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "__NAME__",
    platforms: [.iOS(.v17)],
    products: [.library(name: "__NAME__", targets: ["__NAME__"])],
    targets: [.target(name: "__NAME__")]
)
"#;
const APP: &str = r#"import SwiftUI

@main
struct __NAME__App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
"#;
const VIEW: &str = r#"import SwiftUI

struct ContentView: View {
    @AppStorage("count") private var count = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("__NAME__").font(.largeTitle)
            Text("Count: \(count)")
            Button("Increment") { count += 1 }
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
"#;

pub(crate) fn path_text(path: &Path) -> Result<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| "Use a path encoded in UTF-8.".into())
}

fn project_files(root: &Path, name: &str, bundle: &str) -> std::io::Result<()> {
    let sources = root.join("Sources").join(name);
    fs::create_dir_all(&sources)?;
    fs::write(root.join("Package.swift"), MANIFEST.replace("__NAME__", name))?;
    fs::write(root.join("xtool.yml"), format!("version: 1\nbundleID: {bundle}\n"))?;
    fs::write(root.join(".gitignore"), "/.build/\n/.bsp/\n/xtool/\n")?;
    fs::write(sources.join(format!("{name}App.swift")), APP.replace("__NAME__", name))?;
    fs::write(sources.join("ContentView.swift"), VIEW.replace("__NAME__", name))
}

#[tauri::command]
pub(crate) async fn create_project(workspace: State<'_, Workspace>, name: String, bundle: String, parent: String) -> Result<String> {
    if !name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        || name.len() > 50 || !name.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("Use a project name starting with a letter and containing only ASCII letters and numbers.".into());
    }
    if bundle.len() > 128 || !bundle.contains('.') || !bundle.split('.').all(|part| {
        !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    }) {
        return Err("Enter a reverse domain bundle identifier such as dev.swiftforge.myapp.".into());
    }
    let parent = PathBuf::from(parent).canonicalize().map_err(|error| error.to_string())?;
    let root = parent.join(&name);
    let text = path_text(&root)?;
    // Reserve the directory before writing any files so an existing project is never overwritten.
    fs::create_dir(&root).map_err(|error| format!("Cannot create {}: {error}", root.display()))?;
    if let Err(error) = project_files(&root, &name, &bundle) {
        return Err(format!("Project creation stopped at {}: {error}", root.display()));
    }
    *workspace.lock().map_err(|error| error.to_string())? = Some(root);
    Ok(text)
}

#[tauri::command]
pub(crate) async fn choose_directory(app: AppHandle) -> Result<Option<String>> {
    app.dialog().file().blocking_pick_folder()
        .map(|folder| folder.into_path().map_err(|error| error.to_string()).and_then(|path| path_text(&path)))
        .transpose()
}

fn run_build(root: PathBuf, configuration: String, cancelled: Arc<AtomicBool>, log: Channel<String>) -> Result<String> {
    let command = format!("exec xtool dev build --ipa --configuration {configuration}");
    // xtool uses terminal I/O even for some noninteractive diagnostics.
    let mut process = Command::new("script");
    process.args(["-qefc", &command, "/dev/null"])
        .env("TERM", "dumb").env("NO_COLOR", "1")
        .current_dir(&root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        process.process_group(0);
    }
    let mut child = process.spawn().map_err(|error| format!("Cannot start xtool build: {error}"))?;
    let output = child.stdout.take().expect("build output is piped");
    let lines = thread::spawn(move || -> Result<Option<String>> {
        let mut artifact = None;
        for line in BufReader::new(output).lines() {
            let line = line.map_err(|error| error.to_string())?;
            let line = line.trim_end_matches('\r');
            if let Some(path) = line.strip_prefix("Wrote to ") {
                artifact = Some(path.trim().to_owned());
            }
            let _ = log.send(line.to_owned());
        }
        Ok(artifact)
    });
    let status = loop {
        if cancelled.load(Ordering::Relaxed) {
            #[cfg(target_os = "linux")]
            {
                // util-linux script runs its PTY command in another session.
                let pid = child.id();
                if let Ok(children) = fs::read_to_string(format!("/proc/{pid}/task/{pid}/children")) {
                    for process in children.split_whitespace().filter_map(|id| id.parse::<i32>().ok()) {
                        // The PTY child is the leader of its own process group.
                        unsafe { libc::kill(-process, libc::SIGTERM) };
                    }
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err("Build cancelled.".into());
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        thread::sleep(Duration::from_millis(100));
    };
    let artifact = lines.join().map_err(|_| "Could not read build output.")??;
    if !status.success() {
        return Err(format!("xtool build failed ({status}). See Build output."));
    }
    let artifact = artifact.ok_or("xtool finished without reporting an IPA.")?;
    let artifact = root.join(artifact).canonicalize().map_err(|error| error.to_string())?;
    if !artifact.starts_with(&root) || artifact.extension().and_then(|ext| ext.to_str()) != Some("ipa") || !artifact.is_file() {
        return Err("xtool did not produce an IPA inside this project.".into());
    }
    path_text(&artifact)
}

#[tauri::command]
pub(crate) async fn build_project(workspace: State<'_, Workspace>, build: State<'_, Build>, root: String, configuration: String, log: Channel<String>) -> Result<String> {
    if configuration != "debug" && configuration != "release" {
        return Err("Choose a Debug or Release build.".into());
    }
    let root = {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        active_root(&state, &root)?.to_owned()
    };
    if !root.join("Package.swift").is_file() || !root.join("xtool.yml").is_file() {
        return Err("An iOS build needs Package.swift and xtool.yml at the root of the project.".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut running = build.0.lock().map_err(|error| error.to_string())?;
        if running.is_some() { return Err("A build is already running.".into()); }
        *running = Some(Arc::clone(&cancelled));
    }
    let result = tauri::async_runtime::spawn_blocking(move || run_build(root, configuration, cancelled, log)).await;
    *build.0.lock().map_err(|error| error.to_string())? = None;
    result.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_build(build: State<'_, Build>) -> Result<()> {
    if let Some(cancelled) = build.0.lock().map_err(|error| error.to_string())?.as_ref() {
        cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn export_ipa(app: AppHandle, workspace: State<'_, Workspace>, root: String, artifact: String) -> Result<Option<String>> {
    let source = PathBuf::from(&artifact).canonicalize().map_err(|error| error.to_string())?;
    {
        let state = workspace.lock().map_err(|error| error.to_string())?;
        if !source.starts_with(active_root(&state, &root)?) || source.extension().and_then(|ext| ext.to_str()) != Some("ipa") {
            return Err("Choose an IPA built inside the current project.".into());
        }
    }
    let name = source.file_name().and_then(|file| file.to_str()).ok_or("Cannot read the IPA name.")?;
    let Some(destination) = app.dialog().file().set_file_name(name).add_filter("iOS archive", &["ipa"]).blocking_save_file() else {
        return Ok(None);
    };
    let destination = destination.into_path().map_err(|error| error.to_string())?;
    if destination.canonicalize().ok().as_ref() != Some(&source) {
        fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    }
    Ok(Some(path_text(&destination)?))
}

#[tauri::command]
pub(crate) async fn toolchain_status() -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        [("Swift", "swift", &["--version"][..]), ("xtool", "xtool", &["--version"][..]), ("Darwin SDK", "xtool", &["sdk", "status"][..])]
            .iter().map(|(label, program, args)| {
                let line = Command::new(program).args(*args).output().ok()
                    .filter(|output| output.status.success())
                    .map(|output| String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("Unknown").to_owned())
                    .unwrap_or_else(|| "Unavailable".into());
                format!("{label} · {line}")
            }).collect()
    }).await.map_err(|error| error.to_string())
}

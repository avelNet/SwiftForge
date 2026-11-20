use crate::{active_root, Result, Workspace};
use tauri::State;

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        fs, io::Write, os::unix::fs::OpenOptionsExt, path::{Path, PathBuf},
        process::{Child, Command, Stdio}, sync::{Mutex, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant},
    };
    use tauri::Manager;

    #[derive(Default)]
    pub(crate) struct Simulator(Mutex<Option<Session>>, AtomicU64);

    struct Session {
        process: Child,
        directory: tempfile::TempDir,
        capture: Option<Instant>,
        dimensions: Option<(u32, u32)>,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            let _ = self.process.kill();
            let _ = self.process.wait();
        }
    }

    impl Session {
        fn send(&self, command: &str) -> Result<bool> {
            let pipe = self.directory.path().join("control");
            match fs::OpenOptions::new().write(true).custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW).open(pipe) {
                Ok(mut pipe) => pipe.write_all(command.as_bytes()).map(|_| true).map_err(|error| error.to_string()),
                Err(error) if matches!(error.raw_os_error(), Some(libc::ENXIO | libc::ENOENT)) => Ok(false),
                Err(error) => Err(error.to_string()),
            }
        }
    }

    fn tool(directory: &Path) -> Command {
        let executable = std::env::var_os("SWIFTFORGE_ISIM").unwrap_or_else(|| "isim".into());
        let mut command = Command::new(executable);
        command.env("ISIM_DATA", directory.join("data"));
        command
    }

    fn checked(command: &mut Command) -> Result<()> {
        let result = command.output().map_err(|error| format!("Cannot start isim: {error}"))?;
        if result.status.success() { return Ok(()); }
        let mut text = String::from_utf8_lossy(&result.stderr).trim().to_owned();
        if text.is_empty() { text = String::from_utf8_lossy(&result.stdout).trim().to_owned(); }
        Err(format!("isim build failed ({}).\n{}", result.status, text.lines().rev().take(24).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")))
    }

    fn copy_sources(source: &Path, destination: &Path) -> Result<()> {
        for item in fs::read_dir(source).map_err(|error| error.to_string())? {
            let item = item.map_err(|error| error.to_string())?;
            let kind = item.file_type().map_err(|error| error.to_string())?;
            let target = destination.join(item.file_name());
            if kind.is_dir() {
                fs::create_dir(&target).map_err(|error| error.to_string())?;
                copy_sources(&item.path(), &target)?;
            } else if kind.is_file() {
                fs::copy(item.path(), target).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    fn build(root: &Path, directory: &Path) -> Result<PathBuf> {
        let mut projects: Vec<_> = fs::read_dir(root).map_err(|error| error.to_string())?
            .filter_map(std::result::Result::ok).map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|value| value == "xcodeproj") && path.is_dir()).collect();
        let output = directory.join("build");
        let project = if projects.len() == 1 {
            projects.pop().unwrap()
        } else if projects.is_empty() && root.join("xtool.yml").is_file() {
            let mut targets: Vec<_> = fs::read_dir(root.join("Sources")).map_err(|error| error.to_string())?
                .filter_map(std::result::Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir())).collect();
            if targets.len() != 1 { return Err("Simulator preview needs exactly one Sources target.".into()); }
            let template = directory.join("project");
            checked(tool(directory).arg("new").arg("PreviewApp").arg("-o").arg(&template))?;
            let destination = template.join("PreviewApp");
            fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
            fs::create_dir(&destination).map_err(|error| error.to_string())?;
            copy_sources(&targets.pop().unwrap().path(), &destination)?;
            template.join("PreviewApp.xcodeproj")
        } else {
            return Err("Open a SwiftForge app or a folder with one Xcode project.".into());
        };
        checked(tool(directory).current_dir(project.parent().unwrap_or(root))
            .arg("build").arg("-project").arg(project).arg("-o").arg(&output))?;
        let mut apps: Vec<_> = fs::read_dir(output).map_err(|error| error.to_string())?
            .filter_map(std::result::Result::ok).map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "app")).collect();
        if apps.len() != 1 { return Err("isim did not produce exactly one app.".into()); }
        Ok(apps.pop().unwrap())
    }

    #[tauri::command]
    pub(crate) async fn simulator_start(app: tauri::AppHandle, root: String, device: String) -> Result<()> {
        if !matches!(device.as_str(), "iphone13mini" | "iphone15promax") { return Err("Unknown simulator device.".into()); }
        tauri::async_runtime::spawn_blocking(move || {
            let workspace = app.state::<Workspace>();
            let path = {
                let state = workspace.lock().map_err(|error| error.to_string())?;
                active_root(&state, &root)?.to_owned()
            };
            let sim = app.state::<Simulator>();
            let generation = sim.1.fetch_add(1, Ordering::SeqCst) + 1;
            let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
            let bundle = build(&path, directory.path())?;
            let state = workspace.lock().map_err(|error| error.to_string())?;
            active_root(&state, &root)?;
            let mut session = sim.0.lock().map_err(|error| error.to_string())?;
            if sim.1.load(Ordering::SeqCst) != generation { return Err("Simulator launch cancelled.".into()); }
            let process = tool(directory.path()).arg("run").arg(bundle).args(["--headless", "--device", &device, "--control"])
                .arg(directory.path().join("control")).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::inherit())
                .spawn().map_err(|error| error.to_string())?;
            *session = Some(Session { process, directory, capture: None, dimensions: None });
            Ok(())
        }).await.map_err(|error| error.to_string())?
    }

    #[tauri::command]
    pub(crate) fn simulator_frame(sim: State<'_, Simulator>) -> Result<Option<String>> {
        let mut guard = sim.0.lock().map_err(|error| error.to_string())?;
        let Some(session) = guard.as_mut() else { return Ok(None); };
        if let Some(status) = session.process.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("isim exited: {status}"));
        }
        let image = session.directory.path().join("frame.png");
        if let Some(started) = session.capture {
            if let Ok(bytes) = fs::read(&image) {
                if bytes.len() >= 32 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.ends_with(b"IEND\xaeB\x60\x82") {
                    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
                    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
                    session.dimensions = Some((width / 2, height / 2));
                    fs::remove_file(image).map_err(|error| error.to_string())?;
                    session.capture = None;
                    return Ok(Some(STANDARD.encode(bytes)));
                }
            }
            if started.elapsed() < Duration::from_secs(2) { return Ok(None); }
        }
        if session.send(&format!("shot {}\n", image.display()))? { session.capture = Some(Instant::now()); }
        Ok(None)
    }

    #[tauri::command]
    pub(crate) fn simulator_tap(sim: State<'_, Simulator>, x: f64, y: f64) -> Result<()> {
        if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) { return Ok(()); }
        let state = sim.0.lock().map_err(|error| error.to_string())?;
        if let Some(session) = state.as_ref() {
            if let Some((width, height)) = session.dimensions {
                session.send(&format!("tap {} {}\n", (x * f64::from(width)) as u32, (y * f64::from(height)) as u32))?;
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub(crate) fn simulator_stop(sim: State<'_, Simulator>) -> Result<()> {
        sim.1.fetch_add(1, Ordering::SeqCst);
        sim.0.lock().map_err(|error| error.to_string())?.take();
        Ok(())
    }
}

#[cfg(target_os = "linux")]
pub(crate) use linux::*;

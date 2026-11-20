use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    env,
    io::{self, BufRead, BufReader, Read},
    net::{Ipv4Addr, TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::State;

const MAX_FRAME: usize = 2 * 1024 * 1024;
const RECEIVER_NAME: &str = "SwiftForge IDE";
type Frame = Arc<Mutex<Option<Vec<u8>>>>;

#[derive(Default)]
pub(crate) struct Mirror(Mutex<Option<Session>>);

struct Session {
    receiver: Child,
    latest: Frame,
    stop: Arc<AtomicBool>,
    frames: Option<thread::JoinHandle<()>>,
}

impl Session {
    fn next_frame(&mut self) -> Result<Option<String>, String> {
        if let Some(status) = self.receiver.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("UxPlay stopped ({status}). Start mirroring again and reconnect your iPhone."));
        }
        if self.frames.as_ref().is_some_and(|frames| frames.is_finished()) {
            return Err("The local iPhone video reader stopped.".into());
        }
        let frame = self.latest.lock().map_err(|error| error.to_string())?.take();
        Ok(frame.map(|bytes| STANDARD.encode(bytes)))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.receiver.kill();
        let _ = self.receiver.wait();
        if let Some(frames) = self.frames.take() {
            let _ = frames.join();
        }
    }
}

#[derive(Serialize)]
pub(crate) struct Receiver {
    name: &'static str,
    pin: String,
}

struct VideoStream<'a> {
    stream: TcpStream,
    stop: &'a AtomicBool,
}

impl Read for VideoStream<'_> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        while !self.stop.load(Ordering::Relaxed) {
            match self.stream.read(bytes) {
                Err(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {}
                result => return result,
            }
        }
        Ok(0)
    }
}

fn read_frame(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut length = None;
    let mut line = String::new();
    for _ in 0..8 {
        line.clear();
        if reader.take(256).read_line(&mut line)? == 0 {
            return Ok(None);
        }
        match line.trim() {
            "" if length.is_some() => break,
            value => {
                if let Some(size) = value.strip_prefix("Content-Length: ") {
                    length = size.parse::<usize>().ok();
                }
            }
        }
    }
    let size = length
        .filter(|size| (4..=MAX_FRAME).contains(size) && line.trim().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid mirror frame header"))?;
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes)?;
    if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Invalid JPEG frame"));
    }
    Ok(Some(bytes))
}

pub(crate) fn child_command(binary: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(binary);
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let parent = std::process::id();
        // Only async-signal-safe syscalls are used between fork and exec.
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) == -1 {
                    return Err(io::Error::last_os_error());
                }
                if libc::getppid() as u32 != parent {
                    return Err(io::Error::from_raw_os_error(libc::ESRCH));
                }
                Ok(())
            });
        }
    }
    command
}

fn start() -> Result<(Session, Receiver), String> {
    let mut random = [0; 4];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let pin = format!("{:04}", u32::from_ne_bytes(random) % 10_000);
    let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?;
    socket.set_nonblocking(true).map_err(|error| error.to_string())?;
    let port = socket.local_addr().map_err(|error| error.to_string())?.port();

    let video = format!(
        concat!(
            "videoconvert ! tee name=frames frames. ! queue leaky=downstream max-size-buffers=2 ",
            "! videoscale ! video/x-raw,width=480,pixel-aspect-ratio=1/1 ! jpegenc quality=80 ",
            "! multipartmux boundary=swiftforge ! tcpclientsink host=127.0.0.1 port={} sync=false ",
            "frames. ! queue"
        ),
        port,
    );
    let binary = env::var_os("SWIFTFORGE_UXPLAY").unwrap_or_else(|| "uxplay".into());
    let receiver = child_command(binary)
        .args([
            "-rc", "/dev/null", "-n", RECEIVER_NAME, "-nh", "-pin", &pin, "-a",
            "-fps", "15", "-vsync", "no", "-srgb", "no", "-avdec", "-vc", &video, "-vs", "fakesink",
        ])
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start UxPlay: {error}"))?;

    let latest: Frame = Arc::default();
    let stop = Arc::new(AtomicBool::new(false));
    let buffer = Arc::clone(&latest);
    let stopping = Arc::clone(&stop);
    let frames = thread::spawn(move || {
        while !stopping.load(Ordering::Relaxed) {
            match socket.accept() {
                Ok((stream, _)) => {
                    if let Err(error) = stream.set_read_timeout(Some(Duration::from_millis(250))) {
                        eprintln!("SwiftForge mirror: {error}");
                        continue;
                    }
                    let mut stream = BufReader::new(VideoStream { stream, stop: &stopping });
                    loop {
                        match read_frame(&mut stream) {
                            Ok(Some(frame)) => {
                                let Ok(mut latest) = buffer.lock() else { return };
                                *latest = Some(frame);
                            }
                            Ok(None) => break,
                            Err(error) => {
                                eprintln!("SwiftForge mirror: {error}");
                                break;
                            }
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(error) => {
                    eprintln!("SwiftForge mirror: {error}");
                    break;
                }
            }
        }
    });

    Ok((Session { receiver, latest, stop, frames: Some(frames) }, Receiver { name: RECEIVER_NAME, pin }))
}

#[tauri::command]
pub(crate) fn mirror_start(state: State<'_, Mirror>) -> Result<Receiver, String> {
    let mut active = state.0.lock().map_err(|error| error.to_string())?;
    if active.is_some() {
        return Err("The iPhone receiver is already running.".into());
    }
    let (session, receiver) = start()?;
    *active = Some(session);
    Ok(receiver)
}

#[tauri::command]
pub(crate) fn mirror_next(state: State<'_, Mirror>) -> Result<Option<String>, String> {
    let mut active = state.0.lock().map_err(|error| error.to_string())?;
    let result = active.as_mut().ok_or("The iPhone receiver is stopped.")?.next_frame();
    if result.is_err() {
        active.take();
    }
    result
}

#[tauri::command]
pub(crate) fn mirror_stop(state: State<'_, Mirror>) -> Result<(), String> {
    state.0.lock().map_err(|error| error.to_string())?.take();
    Ok(())
}

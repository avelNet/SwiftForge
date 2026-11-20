use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    env,
    io::{self, BufRead, BufReader, Read},
    net::{Ipv4Addr, UdpSocket},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::State;

const MAX_FRAME: usize = 2 * 1024 * 1024;
const RECEIVER_NAME: &str = "SwiftForge IDE";
type Frame = Arc<Mutex<Option<Vec<u8>>>>;

#[derive(Default)]
pub(crate) struct Mirror(Mutex<Option<Session>>);

struct Session {
    receiver: Child,
    decoder: Child,
    latest: Frame,
    frames: thread::JoinHandle<()>,
}

impl Session {
    fn next_frame(&mut self) -> Result<Option<String>, String> {
        for (name, process) in [("UxPlay", &mut self.receiver), ("GStreamer", &mut self.decoder)] {
            if let Some(status) = process.try_wait().map_err(|error| error.to_string())? {
                return Err(format!("{name} stopped ({status}). Check the receiver and GStreamer dependencies."));
            }
        }
        if self.frames.is_finished() {
            return Err("The iPhone video stream could not be decoded.".into());
        }
        let frame = self.latest.lock().map_err(|error| error.to_string())?.take();
        Ok(frame.map(|bytes| STANDARD.encode(bytes)))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.receiver.kill();
        let _ = self.decoder.kill();
        let _ = self.receiver.wait();
        let _ = self.decoder.wait();
    }
}

#[derive(Serialize)]
pub(crate) struct Receiver {
    name: &'static str,
    pin: String,
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

fn child_command(binary: impl AsRef<std::ffi::OsStr>) -> Command {
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
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?;
    let port = socket.local_addr().map_err(|error| error.to_string())?.port();
    drop(socket);

    let mut decoder = child_command("gst-launch-1.0")
        .args([
            "-q", "udpsrc", "address=127.0.0.1", &format!("port={port}"),
            "caps=application/x-rtp,media=video,encoding-name=H264,clock-rate=90000,payload=96",
            "!", "rtpjitterbuffer", "latency=40", "drop-on-latency=true",
            "!", "rtph264depay", "!", "h264parse", "!", "avdec_h264",
            "!", "videoconvert", "!", "videoscale", "!", "videorate", "drop-only=true",
            "!", "video/x-raw,width=480,pixel-aspect-ratio=1/1,framerate=12/1",
            "!", "jpegenc", "quality=80", "!", "multipartmux", "boundary=swiftforge",
            "!", "fdsink", "fd=1", "sync=false",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start GStreamer: {error}"))?;

    let binary = env::var_os("SWIFTFORGE_UXPLAY").unwrap_or_else(|| "uxplay".into());
    let receiver = child_command(binary)
        .args([
            "-rc", "/dev/null", "-n", RECEIVER_NAME, "-nh", "-pin", &pin, "-a",
            "-vrtp", &format!("config-interval=1 ! udpsink host=127.0.0.1 port={port}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn();
    let receiver = match receiver {
        Ok(receiver) => receiver,
        Err(error) => {
            let _ = decoder.kill();
            let _ = decoder.wait();
            return Err(format!("Could not start UxPlay: {error}"));
        }
    };

    let mut frames = BufReader::new(decoder.stdout.take().expect("decoder stdout is piped"));
    let latest: Frame = Arc::default();
    let buffer = Arc::clone(&latest);
    let frames = thread::spawn(move || {
        while let Ok(Some(frame)) = read_frame(&mut frames) {
            let Ok(mut latest) = buffer.lock() else { break };
            *latest = Some(frame);
        }
    });

    Ok((Session { receiver, decoder, latest, frames }, Receiver { name: RECEIVER_NAME, pin }))
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

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

interface Receiver {
  name: string;
  pin: string;
}

export function IPhonePanel() {
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopping = useRef(false);

  useEffect(() => {
    if (!receiver) return;
    let active = true;
    let timer: number;
    let lastFrame = 0;

    async function poll() {
      try {
        const image = await invoke<string | null>("mirror_next");
        if (!active || stopping.current) return;
        if (image) {
          lastFrame = performance.now();
          setFrame(`data:image/jpeg;base64,${image}`);
        } else if (lastFrame && performance.now() - lastFrame > 5_000) {
          setFrame(null);
        }
        timer = window.setTimeout(poll, 80);
      } catch (problem) {
        if (!active || stopping.current) return;
        setError(String(problem));
        setReceiver(null);
        setFrame(null);
      }
    }

    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [receiver]);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (receiver) {
        stopping.current = true;
        await invoke("mirror_stop");
        setReceiver(null);
        setFrame(null);
      } else {
        stopping.current = false;
        setReceiver(await invoke<Receiver>("mirror_start"));
      }
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="iphone-panel" aria-label="iPhone preview">
      <header className="iphone-header">
        <h2>iPhone</h2>
        <button className={receiver ? undefined : "primary"} disabled={busy} onClick={() => void toggle()}>
          {receiver ? "Stop mirroring" : "Start mirroring"}
        </button>
      </header>
      <div className="iphone-viewport">
        {frame
          ? <img src={frame} alt="Live screen from the connected iPhone" />
          : <div className="iphone-instructions">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="7" y="2.5" width="10" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 18.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {receiver
                ? <><p>Choose <strong>{receiver.name}</strong> in Screen Mirroring on your iPhone.</p>
                    <p className="pairing-code" aria-label={`AirPlay PIN ${receiver.pin}`}>{receiver.pin}</p></>
                : <p>Start mirroring to display your iPhone screen here.</p>}
            </div>}
      </div>
      <p className={error ? "iphone-status error" : "iphone-status"} role="status">
        {error || (frame ? "Live · control on iPhone" : receiver ? "Waiting for iPhone" : "Receiver off")}
      </p>
    </aside>
  );
}

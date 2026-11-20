import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { AirplayIcon, DeviceMobileIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";

interface Receiver {
  name: string;
  pin: string;
}

export function IPhonePanel({ visible, onReceiverChange }: {
  visible: boolean;
  onReceiverChange: (active: boolean) => void;
}) {
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopping = useRef(false);
  const receiving = receiver !== null;
  useEffect(() => onReceiverChange(receiving), [receiving, onReceiverChange]);

  useEffect(() => {
    if (!receiver) return;
    let active = true;
    let timer: number;
    let lastFrame = 0;
    let polling = false;

    async function poll() {
      if (polling || !active || stopping.current) return;
      polling = true;
      try {
        const image = await invoke<string | null>("mirror_next");
        if (!active || stopping.current) return;
        if (image) {
          lastFrame = performance.now();
          setFrame(`data:image/jpeg;base64,${image}`);
          setStale(false);
        } else if (lastFrame && performance.now() - lastFrame > 5_000) {
          setStale(true);
        }
        timer = window.setTimeout(poll, 80);
      } catch (problem) {
        if (!active || stopping.current) return;
        setError(String(problem));
        setReceiver(null);
        setFrame(null);
      } finally {
        polling = false;
      }
    }

    function resume() {
      if (document.visibilityState !== "visible" || polling) return;
      window.clearTimeout(timer);
      void poll();
    }

    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
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
        setStale(false);
        stopping.current = false;
        setReceiver(await invoke<Receiver>("mirror_start"));
      }
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  const connection = error ? "error" : frame ? (stale ? "paused" : "live") : receiver ? "waiting" : "off";
  const description = frame ? (stale ? "Waiting for new frames" : "Live · control on iPhone") :
    receiver ? "Waiting for iPhone" : "Receiver off";

  return (
    <aside className="iphone-panel" id="iphone-preview" aria-label="iPhone preview" hidden={!visible}>
      <div className="panel-heading iphone-heading">
        <h2><DeviceMobileIcon size={16} aria-hidden /> iPhone</h2>
        <span className={`connection-dot ${connection}`} aria-hidden="true" />
      </div>
      <div className="device-stage">
        <div className={`phone-outline${frame ? " showing-video" : ""}${frame && landscape ? " landscape" : ""}`}>
          <div className="phone-screen">
            {frame
              ? <div className="iphone-viewport"><img src={frame} alt="Live screen from the connected iPhone"
                  onLoad={event => setLandscape(event.currentTarget.naturalWidth > event.currentTarget.naturalHeight)} /></div>
              : <AirplayIcon size={36} weight="light" aria-hidden />}
          </div>
        </div>
      </div>
      <div className="iphone-controls">
        {error
          ? <p className="iphone-error" role="alert"><WarningCircleIcon size={16} aria-hidden />{error}</p>
          : receiver && !frame
            ? <div className="pairing-instructions">
                <p>Choose <strong>{receiver.name}</strong> in Screen Mirroring.</p>
                <span className="pairing-code" aria-label={`AirPlay PIN ${receiver.pin}`}>{receiver.pin}</span>
              </div>
            : !receiver && <p className="iphone-instructions">See your physical iPhone here over AirPlay.</p>}
        <button className={receiver ? "action mirror-action" : "action primary mirror-action"} disabled={busy}
          onClick={() => void toggle()}>
          {receiver ? <StopIcon size={16} aria-hidden /> : <AirplayIcon size={16} aria-hidden />}
          {receiver ? "Stop mirroring" : "Start mirroring"}
        </button>
        <p className="iphone-status" role="status">{description}</p>
      </div>
    </aside>
  );
}

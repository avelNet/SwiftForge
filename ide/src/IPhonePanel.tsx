import { SimulatorPreview } from "./SimulatorPreview";
import { useLocale } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AirplayIcon, DeviceMobileIcon, GearSixIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";

const frameInterval = 1000 / 30;

interface Receiver {
  name: string;
  pin: string;
}

export function IPhonePanel({ visible, onReceiverChange, root, dirty, revision, children }: {
  visible: boolean;
  root: string | null;
  dirty: boolean;
  revision: number;
  children?: ReactNode;
  onReceiverChange: (active: boolean) => void;
}) {
  const t = useLocale();
  const [simulate, setSimulate] = useState(false);
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [frameRatio, setFrameRatio] = useState(0);
  const [previewSize, setPreviewSize] = useState("fit");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFrame, setShowFrame] = useState(true);
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
      const started = performance.now();
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
        // Include IPC time in the frame budget so slower reads do not add a full interval.
        const interval = document.visibilityState === "visible" ? frameInterval : 200;
        timer = window.setTimeout(poll, Math.max(0, interval - (performance.now() - started)));
      } catch (problem) {
        if (!active || stopping.current) return;
        setError(String(problem));
        setReceiver(null);
        setFrame(null);
        setFrameRatio(0);
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
        setFrameRatio(0);
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
  const description = frame ? (stale ? t("Waiting for new frames") : t("Live · control on iPhone")) :
    receiver ? t("Waiting for iPhone") : t("Receiver off");

  return (
    <aside className="iphone-panel" id="iphone-preview" aria-label={t("iPhone preview")} hidden={!visible}>
      <div className="panel-heading iphone-heading">
        <h2><DeviceMobileIcon size={16} aria-hidden /> iPhone</h2>
        <div className="phone-heading-actions">
          <span className={`connection-dot ${connection}`} aria-hidden="true" />
          <button className="icon-button" hidden={simulate} aria-label={t("Device display settings")} title={t("Device display settings")}
            aria-expanded={settingsOpen} aria-controls="device-display-settings" onClick={() => setSettingsOpen(value => !value)}>
            <GearSixIcon size={16} />
          </button>
        </div>
      </div>
      {/Linux/i.test(navigator.platform) && <div className="device-modes" role="group" aria-label={t("Device")}>
        <button className="action" aria-pressed={!simulate} onClick={() => setSimulate(false)}>{t("My iPhone")}</button>
        <button className="action" aria-pressed={simulate} onClick={() => setSimulate(true)}>{t("Simulator")}</button>
      </div>}
      {simulate ? <SimulatorPreview key={root ?? ""} root={root} dirty={dirty} revision={revision} /> : <>
      <div className="device-display-settings" id="device-display-settings" hidden={!settingsOpen}>
        <label>{t("Preview size")} <select value={previewSize} onChange={event => setPreviewSize(event.target.value)}>
          <option value="fit">{t("Fit")}</option><option value="compact">{t("Compact")}</option>
        </select></label>
        <label><input type="checkbox" checked={showFrame} onChange={event => setShowFrame(event.target.checked)} /> {t("Show phone frame")}</label>
      </div>
      <div className="device-stage" data-size={previewSize} data-frame={showFrame}>
        <div className={`phone-outline${frame ? " showing-video" : ""}${frameRatio > 1 ? " landscape" : ""}`}
          style={frameRatio ? { "--screen-ratio": frameRatio } as CSSProperties : undefined}>
          <span className="phone-buttons" aria-hidden="true" />
          <div className="phone-screen">
            {frame
              ? <div className="iphone-viewport"><img src={frame} alt={t("Live screen from the connected iPhone")}
                  onLoad={event => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    if (naturalWidth && naturalHeight) setFrameRatio(naturalWidth / naturalHeight);
                  }} /></div>
              : <AirplayIcon size={36} weight="light" aria-hidden />}
          </div>
        </div>
      </div>
      <div className="iphone-controls">
        {error
          ? <p className="iphone-error" role="alert"><WarningCircleIcon size={16} aria-hidden />{error}</p>
          : receiver && !frame
            ? <div className="pairing-instructions">
                <p>{t("Choose {name} in Screen Mirroring.", { name: receiver.name })}</p>
                <span className="pairing-code" aria-label={`AirPlay PIN ${receiver.pin}`}>{receiver.pin}</span>
              </div>
            : !receiver && <p className="iphone-instructions">{t("See your physical iPhone here over AirPlay.")}</p>}
        <button className={receiver ? "action mirror-action" : "action primary mirror-action"} disabled={busy}
          onClick={() => void toggle()}>
          {receiver ? <StopIcon size={16} aria-hidden /> : <AirplayIcon size={16} aria-hidden />}
          {receiver ? t("Stop mirroring") : t("Start mirroring")}
        </button>
        <p className="iphone-status" role="status">{description}</p>
      </div>
      {children}
      </>}
    </aside>
  );
}

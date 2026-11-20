import { invoke } from "@tauri-apps/api/core";
import { ArrowClockwiseIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocale } from "./i18n";

export function SimulatorPreview({ root, dirty, revision }: { root: string | null; dirty: boolean; revision: number }) {
  const t = useLocale();
  const [auto, setAuto] = useState(false);
  const lastRevision = useRef(revision);
  const [device, setDevice] = useState("iphone13mini");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState("");
  const [ratio, setRatio] = useState(0.46);
  const [error, setError] = useState("");

  useEffect(() => () => { void invoke("simulator_stop").catch(() => {}); }, []);
  useEffect(() => {
    if (!running) return;
    let active = true;
    let timer: number;
    async function capture() {
      try {
        const png = await invoke<string | null>("simulator_frame");
        if (!active) return;
        if (png) setImage(`data:image/png;base64,${png}`);
        timer = window.setTimeout(capture, 90);
      } catch (problem) {
        if (active) {
          setError(String(problem));
          setRunning(false);
        }
      }
    }
    void capture();
    return () => { active = false; window.clearTimeout(timer); };
  }, [running]);

  async function launch() {
    if (!root || busy || dirty) return;
    lastRevision.current = revision;
    setBusy(true);
    setRunning(false);
    setImage("");
    setError("");
    try {
      await invoke("simulator_stop");
      await invoke("simulator_start", { root, device });
      setRunning(true);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (auto && running && !busy && !dirty && revision !== lastRevision.current) void launch();
  }, [auto, running, busy, dirty, revision]);

  return <>
    <div className="simulator-toolbar">
      <select aria-label={t("Simulated device")} value={device} disabled={busy || running}
        onChange={event => setDevice(event.target.value)}>
        <option value="iphone13mini">iPhone 13 mini</option>
        <option value="iphone15promax">iPhone 15 Pro Max</option>
      </select>
      <button className="action primary" disabled={!root || busy || dirty} onClick={() => void launch()}
        title={dirty ? t("Save all modified files before building.") : undefined}>
        {running ? <ArrowClockwiseIcon size={15} aria-hidden /> : <PlayIcon size={15} weight="fill" aria-hidden />}
        {busy ? t("Building…") : running ? t("Rebuild preview") : t("Run preview")}
      </button>
      {running && <button className="icon-button" aria-label={t("Stop preview")} onClick={() => {
        setRunning(false);
        setImage("");
        void invoke("simulator_stop").catch(problem => setError(String(problem)));
      }}><StopIcon size={15} aria-hidden /></button>}
      <label className="simulator-auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />
        {t("Rebuild on save")}</label>
    </div>
    <div className="device-stage">
      <div className={image ? "phone-outline showing-video" : "phone-outline"}
        style={{ "--screen-ratio": ratio } as CSSProperties}>
        <div className="phone-screen">
          {image && <img className="simulator-image" src={image} alt={t("Simulated app screen")}
            onLoad={({ currentTarget }) => setRatio(currentTarget.naturalWidth / currentTarget.naturalHeight)}
            onClick={event => {
              const frame = event.currentTarget.getBoundingClientRect();
              void invoke("simulator_tap", { x: (event.clientX - frame.left) / frame.width,
                y: (event.clientY - frame.top) / frame.height }).catch(problem => setError(String(problem)));
            }} />}
        </div>
      </div>
    </div>
    {error && <pre className="simulator-error" role="alert">{t(error)}</pre>}
    {!root && <p className="simulator-error">{t("Open a Swift project")}</p>}
  </>;
}

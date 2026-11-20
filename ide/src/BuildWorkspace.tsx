import { useLocale, type Translate } from "./i18n";
import { Channel, invoke } from "@tauri-apps/api/core";
import { FolderOpenIcon, HammerIcon, PlusIcon, StopIcon, TerminalWindowIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export function NewProject({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (root: string) => Promise<void>;
}) {
  const t = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [bundle, setBundle] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestedBundle = `dev.swiftforge.${name.toLowerCase().replace(/[^a-z0-9]/g, "") || "myapp"}`;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function choose() {
    try {
      const result = await invoke<string | null>("choose_directory");
      if (result) setParent(result);
    } catch (problem) {
      setError(String(problem));
    }
  }

  return (
    <dialog ref={dialog} className="workbench-dialog" onCancel={event => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
      <form onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onCreate(await invoke<string>("create_project", { name, bundle: bundle || suggestedBundle, parent }));
        } catch (problem) {
          setError(String(problem));
        } finally {
          setBusy(false);
        }
      }}>
        <div className="dialog-heading"><h1>{t("New SwiftUI project")}</h1>
          <button type="button" className="icon-button" aria-label={t("Close new project")} onClick={onCancel} disabled={busy}><XIcon size={16} /></button>
        </div>
        <label>{t("Project name")}<input autoFocus required pattern="[A-Za-z][A-Za-z0-9]*" maxLength={50} value={name}
          onChange={event => setName(event.target.value)} placeholder="MyApp" /></label>
        <label>{t("Bundle identifier")}<input value={bundle} onChange={event => setBundle(event.target.value)} placeholder={suggestedBundle} /></label>
        <label>{t("Location")}<span className="location-field">
          <input required value={parent} onChange={event => setParent(event.target.value)} placeholder="/home/you/Projects" />
          <button type="button" className="action" onClick={() => void choose()}><FolderOpenIcon size={16} /> {t("Browse")}</button>
        </span></label>
        {error && <p role="alert" className="status error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="action" disabled={busy} onClick={onCancel}>{t("Cancel")}</button>
          <button className="action primary" disabled={busy || !name || !parent} type="submit"><PlusIcon size={16} /> {t("Create project")}</button>
        </div>
      </form>
    </dialog>
  );
}

export function useBuild(t: Translate, root: string | null, canBuild: () => boolean) {
  const [configuration, setConfiguration] = useState<"debug" | "release">("debug");
  const [visible, setVisible] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const logView = useRef<HTMLPreElement>(null);
  const busy = useRef(false);
  useEffect(() => {
    setArtifact(null);
    setStatus("");
    setOutput([]);
  }, [root]);
  useEffect(() => {
    const view = logView.current;
    if (view) view.scrollTop = view.scrollHeight;
  }, [output, visible]);

  function write(line: string) {
    setOutput(lines => [...lines.slice(-1999), line]);
  }

  async function build() {
    if (!root || busy.current || !canBuild()) return;
    busy.current = true;
    setVisible(true);
    setRunning(true);
    setArtifact(null);
    setStatus("Building…");
    setOutput([]);
    const log = new Channel<string>();
    log.onmessage = write;
    try {
      const result = await invoke<string>("build_project", { root, configuration, log });
      setArtifact(result);
      setStatus("IPA ready");
    } catch (problem) {
      setStatus(String(problem));
      write(String(problem));
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }

  async function check() {
    setVisible(true);
    try {
      const versions = await invoke<string[]>("toolchain_status");
      for (const version of versions) write(version);
    } catch (problem) {
      write(String(problem));
    }
  }

  async function exportIPA() {
    if (!artifact || !root) return;
    try {
      const destination = await invoke<string | null>("export_ipa", { root, artifact });
      if (destination) write(`Exported ${destination}`);
      return destination;
    } catch (problem) {
      write(String(problem));
      return null;
    }
  }

  const stop = () => void invoke("cancel_build").catch(error => write(String(error)));

  return {
    visible, setVisible, running, status, artifact, build, check, exportIPA, write,
    controls: <div className="build-controls" role="group" aria-label={t("Build controls")}>
      <select aria-label={t("Build configuration")} value={configuration}
        onChange={event => setConfiguration(event.target.value === "release" ? "release" : "debug")} disabled={running}>
        <option value="debug">{t("Debug")}</option><option value="release">{t("Release")}</option>
      </select>
      {running
        ? <button className="action build-stop" onClick={stop} title={t("Cancel build")} aria-label={t("Cancel build")}>
            <StopIcon size={15} weight="fill" /><span>{t("Cancel build")}</span>
          </button>
        : <button className="action build-start" onClick={() => void build()} disabled={!root} title={t("Build IPA")} aria-label={t("Build")}>
            <HammerIcon size={16} weight="bold" /><span>{t("Build")}</span>
          </button>}
    </div>,
    panel: visible && <section aria-label={t("Build output")} className="output-pane">
      <div className="output-toolbar">
        <h2><TerminalWindowIcon size={16} /> {t("Build output")}</h2>
        <span role="status">{t(status)}</span>
        <div>
          {running && <button className="action" onClick={stop}>{t("Cancel build")}</button>}
          {artifact && <button className="action" onClick={() => void exportIPA()}>{t("Export IPA")}</button>}
          <button className="action" onClick={() => void check()}>{t("Toolchain")}</button>
          <button className="icon-button" onClick={() => setVisible(false)} aria-label={t("Hide build output")}><XIcon size={16} /></button>
        </div>
      </div>
      <pre ref={logView} aria-label={t("Build log")}>{output.join("\n")}</pre>
    </section>,
  };
}

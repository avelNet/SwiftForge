import { Channel, invoke } from "@tauri-apps/api/core";
import { FolderOpenIcon, HammerIcon, PlusIcon, TerminalWindowIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export function NewProject({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (root: string) => Promise<void>;
}) {
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
        <div className="dialog-heading"><h1>New SwiftUI project</h1>
          <button type="button" className="icon-button" aria-label="Close new project" onClick={onCancel} disabled={busy}><XIcon size={16} /></button>
        </div>
        <label>Project name<input autoFocus required pattern="[A-Za-z][A-Za-z0-9]*" maxLength={50} value={name}
          onChange={event => setName(event.target.value)} placeholder="MyApp" /></label>
        <label>Bundle identifier<input value={bundle} onChange={event => setBundle(event.target.value)} placeholder={suggestedBundle} /></label>
        <label>Location<span className="location-field">
          <input required value={parent} onChange={event => setParent(event.target.value)} placeholder="/home/you/Projects" />
          <button type="button" className="action" onClick={() => void choose()}><FolderOpenIcon size={16} /> Browse</button>
        </span></label>
        {error && <p role="alert" className="status error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="action" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="action primary" disabled={busy || !name || !parent} type="submit"><PlusIcon size={16} /> Create project</button>
        </div>
      </form>
    </dialog>
  );
}

export function useBuild(root: string | null, canBuild: () => boolean) {
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
    } catch (problem) {
      write(String(problem));
    }
  }

  return {
    visible, setVisible, running, status, artifact, build, check, exportIPA, write,
    controls: <>
      <select aria-label="Build configuration" value={configuration} onChange={event => setConfiguration(event.target.value === "release" ? "release" : "debug")} disabled={running}>
        <option value="debug">Debug</option><option value="release">Release</option>
      </select>
      <button className="action" onClick={() => void build()} disabled={!root || running}><HammerIcon size={16} /> Build</button>
    </>,
    panel: visible && <section aria-label="Build output" className="output-pane">
      <div className="output-toolbar">
        <h2><TerminalWindowIcon size={16} /> Build output</h2>
        <span role="status">{status}</span>
        <div>
          {running && <button className="action" onClick={() => void invoke("cancel_build").catch(error => write(String(error)))}>Cancel build</button>}
          {artifact && <button className="action" onClick={() => void exportIPA()}>Export IPA</button>}
          <button className="action" onClick={() => void check()}>Toolchain</button>
          <button className="icon-button" onClick={() => setVisible(false)} aria-label="Hide build output"><XIcon size={16} /></button>
        </div>
      </div>
      <pre ref={logView} aria-label="Build log">{output.join("\n")}</pre>
    </section>,
  };
}

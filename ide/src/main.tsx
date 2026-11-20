import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { editor, Uri } from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef, useState } from "react";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "./styles.css";

self.MonacoEnvironment = {
  getWorker: (_module, label) => label === "json" ? new JsonWorker() : new EditorWorker(),
};

interface Entry {
  name: string;
  path: string;
  directory: boolean;
}

interface OpenDocument {
  model: editor.ITextModel;
  saved: string;
  diskText: string;
  subscription: { dispose(): void };
}

function language(path: string) {
  if (path.endsWith(".swift")) return "swift";
  if (path.endsWith(".json")) return "json";
  if (/\.ya?ml$/.test(path)) return "yaml";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

function FileTree({ path, folders, active, onSelect }: {
  path: string;
  folders: Map<string, Entry[]>;
  active: string | null;
  onSelect: (entry: Entry) => void;
}) {
  return <ul>{folders.get(path)?.map(entry => (
    <li key={entry.path}>
      <button className={active === entry.path ? "entry selected" : "entry"} onClick={() => onSelect(entry)}
        title={entry.path} aria-expanded={entry.directory ? folders.has(entry.path) : undefined}>
        <span aria-hidden="true">{entry.directory ? (folders.has(entry.path) ? "▾" : "▸") : "·"}</span>{entry.name}
      </button>
      {entry.directory && folders.has(entry.path) &&
        <FileTree path={entry.path} folders={folders} active={active} onSelect={onSelect} />}
    </li>
  ))}</ul>;
}

function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [folders, setFolders] = useState(new Map<string, Entry[]>());
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [, redraw] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const documents = useRef(new Map<string, OpenDocument>());
  const views = useRef(new Map<string, editor.ICodeEditorViewState>());
  const displayed = useRef<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    const code = editor.create(host.current!, {
      model: null, theme: "vs-dark", automaticLayout: true, minimap: { enabled: false },
      fontFamily: "Geist Mono, monospace", fontSize: 14, lineHeight: 22,
      padding: { top: 12 }, scrollBeyondLastLine: false,
    });
    instance.current = code;
    return () => {
      code.dispose();
      for (const doc of documents.current.values()) {
        doc.subscription.dispose();
        doc.model.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const code = instance.current!;
    if (displayed.current && code.getModel()) {
      const view = code.saveViewState();
      if (view) views.current.set(displayed.current, view);
    }
    code.setModel(active ? documents.current.get(active)!.model : null);
    const view = active ? views.current.get(active) : undefined;
    if (view) code.restoreViewState(view);
    displayed.current = active;
  }, [active, root]);

  const dirty = (path: string) => {
    const doc = documents.current.get(path);
    return !!doc && doc.model.getValue(undefined, true) !== doc.saved;
  };

  async function run(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      setNotice(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function openProject() {
    if (tabs.some(dirty)) {
      setNotice("Save your changes before switching projects.");
      return;
    }
    void run(async () => {
      const next = await invoke<string | null>("open_workspace");
      if (!next || next === root) return;
      instance.current?.setModel(null);
      for (const doc of documents.current.values()) {
        doc.subscription.dispose();
        doc.model.dispose();
      }
      documents.current.clear();
      views.current.clear();
      displayed.current = null;
      setActive(null);
      setTabs([]);
      setFolders(new Map());
      setRoot(next);
      const entries = await invoke<Entry[]>("list_directory", { root: next, path: "" });
      setFolders(new Map([["", entries]]));
    });
  }

  function select(entry: Entry) {
    if (!root) return;
    void run(async () => {
      if (entry.directory) {
        const next = new Map(folders);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.set(entry.path, await invoke<Entry[]>("list_directory", { root, path: entry.path }));
        setFolders(next);
        return;
      }
      if (!documents.current.has(entry.path)) {
        const text = await invoke<string>("read_document", { root, path: entry.path });
        const model = editor.createModel(text, language(entry.path), Uri.file(`${root}/${entry.path}`));
        const subscription = model.onDidChangeContent(() => redraw(value => value + 1));
        documents.current.set(entry.path, { model, saved: model.getValue(undefined, true), diskText: text, subscription });
        setTabs(previous => [...previous, entry.path]);
      }
      setActive(entry.path);
    });
  }

  function close(path: string) {
    if (pending.current) return;
    if (dirty(path)) {
      setNotice("Save this file before closing it.");
      return;
    }
    const doc = documents.current.get(path)!;
    const index = tabs.indexOf(path);
    const remaining = tabs.filter(tab => tab !== path);
    if (active === path) {
      instance.current?.setModel(null);
      displayed.current = null;
      setActive(remaining[Math.min(index, remaining.length - 1)] ?? null);
    }
    doc.subscription.dispose();
    doc.model.dispose();
    documents.current.delete(path);
    views.current.delete(path);
    setTabs(remaining);
  }

  function save() {
    if (!root || !active || !dirty(active)) return;
    void run(async () => {
      const doc = documents.current.get(active)!;
      const text = doc.model.getValue(undefined, true);
      await invoke("save_document", { root, path: active, text, previous: doc.diskText });
      doc.diskText = text;
      doc.saved = text;
      redraw(value => value + 1);
    });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <main className="app">
      <header className="toolbar">
        <span className="brand">SwiftForge</span>
        <button className="primary" onClick={openProject} disabled={busy}>Open folder</button>
        <button onClick={save} disabled={busy || !active || !dirty(active)}>Save</button>
      </header>
      <aside aria-label="Project files" className="explorer">
        <h2 title={root ?? undefined}>{root?.split("/").at(-1) || "Project files"}</h2>
        {root && <FileTree path="" folders={folders} active={active} onSelect={select} />}
      </aside>
      <section className="workspace" aria-label="Code workspace">
        <nav className="tabs" aria-label="Open files">
          {tabs.map(path => (
            <div className={path === active ? "tab active" : "tab"} key={path}>
              <button onClick={() => setActive(path)} aria-current={path === active ? "page" : undefined} title={path}>
                {path.split("/").at(-1)}{dirty(path) && <span className="dirty" aria-label="unsaved"> ●</span>}
              </button>
              <button className="close" aria-label={`Close ${path}`} onClick={() => close(path)}>×</button>
            </div>
          ))}
        </nav>
        <div className="editor-area">
          <div ref={host} className="editor" aria-hidden={!active} />
          {!active && <div className="empty">{root ? "Select a file to edit." : "Open a project folder to start."}</div>}
        </div>
      </section>
      <footer className={notice ? "status error" : "status"} role="status">
        {notice || (busy ? "Working…" : active || root || "No project open")}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

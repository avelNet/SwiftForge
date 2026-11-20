import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { editor, Uri, type IPosition, type IRange } from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CaretRightIcon, CheckCircleIcon, CodeIcon, DeviceMobileIcon, FloppyDiskIcon,
  FolderOpenIcon, GearSixIcon, MagnifyingGlassIcon, PlusIcon, TerminalWindowIcon, WarningCircleIcon, XIcon,
} from "@phosphor-icons/react";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "./styles.css";
import { IPhonePanel } from "./IPhonePanel";
import { NewProject, useBuild } from "./BuildWorkspace";
import { SwiftLanguage } from "./swift-language";
import { GitHubClone, Settings, WorkbenchMenu, loadPreferences } from "./WorkbenchTools";
import { DirectoryGlyph, ExplorerButton, FileGlyph, PanelDivider, workbenchTheme } from "./workbench";

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
        {entry.directory ? <DirectoryGlyph expanded={folders.has(entry.path)} /> :
          <><span className="tree-spacer" /><FileGlyph path={entry.path} /></>}
        <span className="entry-name">{entry.name}</span>
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
  const [newProject, setNewProject] = useState(false);
  const [cloneProject, setCloneProject] = useState(false);
  const [settings, setSettings] = useState(false);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [mirrorActive, setMirrorActive] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(220);
  const [phoneWidth, setPhoneWidth] = useState(320);
  const [cursor, setCursor] = useState({ lineNumber: 1, column: 1 });
  const [, redraw] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const documents = useRef(new Map<string, OpenDocument>());
  const views = useRef(new Map<string, editor.ICodeEditorViewState>());
  const displayed = useRef<string | null>(null);
  const jump = useRef<{ path: string; target: IPosition | IRange } | null>(null);
  const pending = useRef(false);
  const swift = useRef<SwiftLanguage | null>(null);
  const [languageStatus, setLanguageStatus] = useState("");

  useEffect(() => {
    const code = editor.create(host.current!, {
      model: null, theme: workbenchTheme, automaticLayout: true, minimap: { enabled: false },
      fontFamily: "Geist Mono, monospace", fontSize: 14, lineHeight: 22,
      padding: { top: 12 }, scrollBeyondLastLine: false, lineNumbersMinChars: 3,
      overviewRulerBorder: false, renderLineHighlightOnlyWhenFocus: true,
    });
    instance.current = code;
    const cursorSubscription = code.onDidChangeCursorPosition(event => setCursor(event.position));
    return () => {
      cursorSubscription.dispose();
      code.dispose();
      for (const doc of documents.current.values()) {
        doc.subscription.dispose();
        doc.model.dispose();
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    localStorage.setItem("swiftforge.preferences", JSON.stringify(preferences));
    editor.setTheme(preferences.theme === "light" ? "vs" : workbenchTheme);
    instance.current?.updateOptions({
      fontSize: preferences.fontSize, lineHeight: Math.round(preferences.fontSize * 1.55),
      wordWrap: preferences.wrap ? "on" : "off", minimap: { enabled: preferences.minimap },
    });
    for (const { model } of documents.current.values()) model.updateOptions({ tabSize: preferences.tabSize });
  }, [preferences]);

  useEffect(() => {
    const code = instance.current!;
    if (displayed.current && code.getModel()) {
      const view = code.saveViewState();
      if (view) views.current.set(displayed.current, view);
    }
    code.setModel(active ? documents.current.get(active)!.model : null);
    const view = active ? views.current.get(active) : undefined;
    if (view) code.restoreViewState(view);
    if (jump.current?.path === active) {
      const target = jump.current.target;
      jump.current = null;
      if ("lineNumber" in target) {
        code.setPosition(target);
        code.revealPositionInCenterIfOutsideViewport(target);
      } else {
        code.setSelection(target);
        code.revealRangeInCenterIfOutsideViewport(target);
      }
      code.focus();
    }
    const position = code.getPosition();
    if (position) setCursor(position);
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

  const build = useBuild(root, () => {
    if (!tabs.some(dirty)) return true;
    setNotice("Save all modified files before building.");
    return false;
  });

  async function adoptProject(next: string) {
    if (next === root) return;
    swift.current?.dispose();
    swift.current = null;
    setLanguageStatus("");
    await invoke("language_stop");
    instance.current?.setModel(null);
    for (const doc of documents.current.values()) {
      doc.subscription.dispose();
      doc.model.dispose();
    }
    documents.current.clear();
    views.current.clear();
    displayed.current = null;
    jump.current = null;
    setActive(null);
    setTabs([]);
    setFolders(new Map());
    setRoot(next);
    const entries = await invoke<Entry[]>("list_directory", { root: next, path: "" });
    setFolders(new Map([["", entries]]));
    if (entries.some(entry => entry.name === "Package.swift")) {
      const server = new SwiftLanguage(next, setLanguageStatus);
      swift.current = server;
      void server.start();
    }
  }

  function canSwitch() {
    if (build.running) {
      setNotice("Finish or cancel the current build before switching projects.");
      return false;
    }
    if (tabs.some(dirty)) {
      setNotice("Save your changes before switching projects.");
      return false;
    }
    return true;
  }

  function openProject() {
    if (!canSwitch()) return;
    void run(async () => {
      const next = await invoke<string | null>("open_workspace");
      if (next) await adoptProject(next);
    });
  }

  function startNewProject() {
    if (canSwitch()) setNewProject(true);
  }

  async function openFile(workspace: string, path: string) {
    if (!documents.current.has(path)) {
      const text = await invoke<string>("read_document", { root: workspace, path });
      const model = editor.createModel(text, language(path), Uri.file(`${workspace}/${path}`));
      model.updateOptions({ tabSize: preferences.tabSize });
      const subscription = model.onDidChangeContent(() => redraw(value => value + 1));
      documents.current.set(path, { model, saved: model.getValue(undefined, true), diskText: text, subscription });
      swift.current?.track(model);
      setTabs(previous => [...previous, path]);
    }
    setActive(path);
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
      await openFile(root, entry.path);
    });
  }

  useEffect(() => {
    const opener = editor.registerEditorOpener({
      async openCodeEditor(_source, resource, target) {
        if (!root || resource.scheme !== "file" || !resource.fsPath.startsWith(root + "/")) return false;
        const path = resource.fsPath.slice(root.length + 1);
        try {
          if (target) jump.current = { path, target };
          await openFile(root, path);
          return true;
        } catch (error) {
          jump.current = null;
          setNotice(String(error));
          return false;
        }
      },
    });
    return () => opener.dispose();
  }, [root, preferences.tabSize]);

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
    swift.current?.untrack(doc.model);
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
      if (newProject || cloneProject || settings || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
      switch (event.key.toLowerCase()) {
        case ",":
          event.preventDefault();
          setSettings(true);
          break;
        case "s":
          event.preventDefault();
          save();
          break;
        case "n":
          event.preventDefault();
          if (!event.repeat) startNewProject();
          break;
        case "o":
          event.preventDefault();
          if (!event.repeat) openProject();
          break;
        case "b":
          event.preventDefault();
          if (!event.repeat) setShowExplorer(value => !value);
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const project = root?.split("/").at(-1);
  const edited = active !== null && dirty(active);
  const activeLanguage = active ? language(active) : null;
  const languageName = activeLanguage === "swift" ? "Swift" :
    activeLanguage === "plaintext" ? "Plain text" :
    activeLanguage === "markdown" ? "Markdown" : activeLanguage?.toUpperCase();
  const layout = {
    "--explorer-width": showExplorer ? `min(30vw, ${explorerWidth}px)` : "0px",
    "--phone-width": showPhone ? `min(34vw, ${phoneWidth}px)` : "0px",
  } as CSSProperties;
  const resizeExplorer = (width: number) => setExplorerWidth(Math.max(160, Math.min(384, width)));
  const resizePhone = (width: number) => setPhoneWidth(Math.max(224, Math.min(480, width)));

  return (
    <main className="app" style={layout}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark"><CodeIcon size={18} weight="bold" aria-hidden /></span>
          <span>SwiftForge</span>
        </div>
        <WorkbenchMenu groups={[
          { label: "File", items: [
            { name: "New project", shortcut: "Ctrl+N", run: startNewProject },
            { name: "Open folder", shortcut: "Ctrl+O", run: openProject },
            { name: "Save", shortcut: "Ctrl+S", enabled: edited, run: save },
            { name: "Settings", shortcut: "Ctrl+,", run: () => setSettings(true) },
          ] },
          { label: "Edit", items: [
            { name: "Undo", shortcut: "Ctrl+Z", enabled: !!active, run: () => instance.current?.trigger("menu", "undo", null) },
            { name: "Redo", shortcut: "Ctrl+Y", enabled: !!active, run: () => instance.current?.trigger("menu", "redo", null) },
            { name: "Find", shortcut: "Ctrl+F", enabled: !!active, run: () => void instance.current?.getAction("actions.find")?.run() },
          ] },
          { label: "View", items: [
            { name: showExplorer ? "Hide Explorer" : "Show Explorer", shortcut: "Ctrl+B", run: () => setShowExplorer(!showExplorer) },
            { name: showPhone ? "Hide iPhone" : "Show iPhone", run: () => setShowPhone(!showPhone) },
            { name: build.visible ? "Hide build output" : "Show build output", run: () => build.setVisible(!build.visible) },
          ] },
          { label: "Build", items: [
            { name: "Build IPA", enabled: !!root && !build.running, run: () => void build.build() },
            { name: "Export IPA", enabled: !!build.artifact, run: () => void build.exportIPA() },
            { name: "Check toolchain", run: () => void build.check() },
          ] },
          { label: "GitHub", items: [
            { name: "Clone repository", run: () => { if (canSwitch()) setCloneProject(true); } },
            { name: "Repository status", enabled: !!root, run: () => void run(async () => {
              build.setVisible(true);
              build.write(await invoke<string>("github_status", { root }));
            }) },
            { name: "Open origin on GitHub", enabled: !!root, run: () => void run(async () => {
              await invoke("github_open", { root });
            }) },
          ] },
        ]} />
        <div className="toolbar-actions">
          <button className="action" onClick={startNewProject} disabled={busy} title="New project · Ctrl+N"><PlusIcon size={17} /> New project</button>
          <button className={root ? "action" : "action primary"} onClick={openProject} disabled={busy} title="Open folder · Ctrl+O">
            <FolderOpenIcon size={17} aria-hidden /> Open folder
          </button>
          <button className="action" onClick={save} disabled={busy || !edited} title="Save · Ctrl+S">
            <FloppyDiskIcon size={17} aria-hidden /> Save
          </button>
          {build.controls}
          <button className="icon-button" aria-label="Settings" title="Settings · Ctrl+," onClick={() => setSettings(true)}><GearSixIcon size={19} /></button>
        </div>
      </header>

      <nav className="activity-rail" aria-label="Workspace tools">
        <ExplorerButton visible={showExplorer} onClick={() => setShowExplorer(value => !value)} />
        <button className="rail-action" aria-label="Find in current file" title="Find in current file · Ctrl+F"
          disabled={!active} onClick={() => void instance.current?.getAction("actions.find")?.run()}>
          <MagnifyingGlassIcon size={21} aria-hidden />
        </button>
        <button className="rail-action" aria-label="Toggle build output" title="Build output" aria-pressed={build.visible}
          onClick={() => build.setVisible(!build.visible)}><TerminalWindowIcon size={21} aria-hidden /></button>
        <button className="rail-action device-toggle" aria-label="Toggle iPhone panel" aria-controls="iphone-preview"
          title={mirrorActive ? "iPhone preview · receiver active" : "iPhone preview"} aria-pressed={showPhone}
          data-active={mirrorActive} onClick={() => setShowPhone(value => !value)}>
          <DeviceMobileIcon size={21} aria-hidden />
        </button>
      </nav>

      <aside aria-label="Project files" id="project-explorer" className="explorer" hidden={!showExplorer}>
        <div className="panel-heading">
          <h2>Explorer</h2>
          <button className="icon-button" onClick={openProject} disabled={busy} aria-label="Open project folder" title="Open project folder">
            <FolderOpenIcon size={17} aria-hidden />
          </button>
        </div>
        {root && <>
          <div className="project-root" title={root}><FolderOpenIcon size={15} aria-hidden /><span>{project}</span></div>
          <FileTree path="" folders={folders} active={active} onSelect={select} />
        </>}
      </aside>
      {showExplorer && <PanelDivider panel="project explorer" side="left" width={explorerWidth} onResize={resizeExplorer} />}

      <section className="workspace" aria-label="Code workspace">
        <nav className="tabs" aria-label="Open files">
          {tabs.map(path => (
            <div className={path === active ? "tab active" : "tab"} key={path}>
              <button className="tab-file" onClick={() => setActive(path)} aria-current={path === active ? "page" : undefined} title={path}>
                <FileGlyph path={path} /><span>{path.split("/").at(-1)}</span>
                {dirty(path) && <span className="dirty-dot" aria-label="unsaved" />}
              </button>
              <button className="close icon-button" aria-label={`Close ${path}`} title="Close tab" onClick={() => close(path)}>
                <XIcon size={13} aria-hidden />
              </button>
            </div>
          ))}
        </nav>
        {active && <div className="breadcrumbs" aria-label="Current file path">
          {[project, ...active.split("/")].filter(Boolean).map((name, index) => (
            <span key={`${index}:${name}`}>{index > 0 && <CaretRightIcon size={11} aria-hidden />}{name}</span>
          ))}
        </div>}
        <div className="editor-area">
          <div ref={host} className="editor" aria-hidden={!active} />
          {!active && <div className="empty">
            <div className="empty-symbol"><CodeIcon size={32} aria-hidden /></div>
            <h1>{root ? "Open a file" : "Open a Swift project"}</h1>
            <p>{root ? "Choose a source file in Explorer." : "Choose an existing project folder to start editing."}</p>
            {root && !showExplorer
              ? <button className="action" onClick={() => setShowExplorer(true)}>Show Explorer</button>
              : !root && <div className="welcome-actions">
                  <button className="action primary" onClick={startNewProject} disabled={busy}><PlusIcon size={17} /> New project</button>
                  <button className="action" onClick={openProject} disabled={busy}><FolderOpenIcon size={17} /> Open folder</button>
                </div>}
          </div>}
        </div>
        {build.panel}
      </section>

      {showPhone && <PanelDivider panel="iPhone preview" side="right" width={phoneWidth} onResize={resizePhone} />}
      <IPhonePanel visible={showPhone} onReceiverChange={setMirrorActive} />

      <footer className={notice ? "status error" : "status"}>
        <span className="status-message" role="status" title={notice || active || root || undefined}>
          {notice ? <WarningCircleIcon size={15} aria-hidden /> : active && !edited && <CheckCircleIcon size={15} aria-hidden />}
          {notice || (busy ? "Working…" : active ? (edited ? "Unsaved changes" : "Saved") : project || "No project open")}
        </span>
        <div className="editor-status">
          {languageStatus && <span title={languageStatus}>{languageStatus}</span>}
          {active && <><span>Ln {cursor.lineNumber}, Col {cursor.column}</span>
            <span>UTF-8</span><span>{languageName}</span></>}
        </div>
      </footer>
      {settings && <Settings value={preferences} change={setPreferences} close={() => setSettings(false)} />}
      {cloneProject && <GitHubClone close={() => setCloneProject(false)} opened={async next => {
        await adoptProject(next);
        setCloneProject(false);
      }} />}
      {newProject && <NewProject onCancel={() => setNewProject(false)} onCreate={async next => {
        await adoptProject(next);
        setNewProject(false);
      }} />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

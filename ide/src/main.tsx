import { Locale, translator } from "./i18n";
import { createRoot } from "react-dom/client";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { editor, KeyCode, KeyMod, Uri, type IPosition, type IRange } from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import {
  ArrowClockwiseIcon, SunIcon, MoonIcon, FilePlusIcon, FolderPlusIcon, SidebarSimpleIcon, CaretRightIcon, ArrowsInLineVerticalIcon, GithubLogoIcon, ListNumbersIcon, ArrowsLeftRightIcon, ArrowBendRightDownIcon, CheckCircleIcon, CodeIcon, DeviceMobileIcon, FloppyDiskIcon,
  FolderOpenIcon, GearSixIcon, MagnifyingGlassIcon, PlusIcon, TerminalIcon, TerminalWindowIcon, WarningCircleIcon, XIcon,
} from "@phosphor-icons/react";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "./styles.css";
import { IPhonePanel } from "./IPhonePanel";
import { GitHubSidebar } from "./GitHubSidebar";
import { DeviceTools } from "./DeviceTools";
import { TerminalPane } from "./TerminalPane";
import { NewProject, useBuild } from "./BuildWorkspace";
import { SwiftLanguage } from "./swift-language";
import { CreateEntryDialog, GitHubClone, Settings, WorkbenchMenu, loadPreferences, zoomLevels } from "./WorkbenchTools";
import { DirectoryGlyph, ExplorerButton, FileGlyph, PanelDivider, workbenchTheme, lightWorkbenchTheme } from "./workbench";

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

function FileTree({ path, folders, expanded, active, onSelect, onContext }: {
  path: string;
  folders: Map<string, Entry[]>;
  expanded: Set<string>;
  active: string | null;
  onSelect: (entry: Entry, leaf: Entry) => void;
  onContext: (event: MouseEvent, entry: Entry) => void;
}) {
  return <ul className="file-tree">{folders.get(path)?.map(entry => {
    const names = [entry.name];
    let leaf = entry;
    while (leaf.directory) {
      const children = folders.get(leaf.path);
      if (children?.length !== 1 || !children[0].directory) break;
      leaf = children[0];
      names.push(leaf.name);
    }
    const open = entry.directory && expanded.has(entry.path);
    return <li key={entry.path}>
      <button className={active === entry.path ? "entry selected" : "entry"} onClick={() => onSelect(entry, leaf)} onContextMenu={event => onContext(event, leaf)}
        title={leaf.path} aria-expanded={entry.directory ? open : undefined}>
        {entry.directory ? <DirectoryGlyph expanded={open} path={leaf.path} /> :
          <><span className="tree-spacer" /><FileGlyph path={entry.path} /></>}
        <span className="entry-name">{names.join(" / ")}</span>
      </button>
      {open && <FileTree path={leaf.path} folders={folders} expanded={expanded} active={active} onSelect={onSelect} onContext={onContext} />}
    </li>;
  })}</ul>;
}

function App() {
  const [sessionRestored, setSessionRestored] = useState(false);
  const [root, setRoot] = useState<string | null>(null);
  const [folders, setFolders] = useState(new Map<string, Entry[]>());
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [entryParent, setEntryParent] = useState("");
  const [newEntry, setNewEntry] = useState<"file" | "folder" | null>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [cloneProject, setCloneProject] = useState(false);
  const [settings, setSettings] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [preferences, setPreferences] = useState(loadPreferences);
  const t = translator(preferences.language);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showExplorer, setShowExplorer] = useState(true);
  const [activeSidebar, setActiveSidebar] = useState<"explorer" | "github">("explorer");
  const [gitRevision, setGitRevision] = useState(0);

  function toggleSidebar(side: "explorer" | "github") {
    setDeviceMode(false);
    setShowExplorer(activeSidebar !== side || !showExplorer);
    setActiveSidebar(side);
  }
  const [deviceMode, setDeviceMode] = useState(false);
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
    code.addCommand(KeyMod.CtrlCmd | KeyCode.KeyD, () => {
      void code.getAction("editor.action.copyLinesDownAction")?.run();
    }, "editorTextFocus && !editorReadonly");
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
    if (!isTauri()) return;
    void getCurrentWebview().setZoom(preferences.zoom / 100).catch(error => setNotice(String(error)));
  }, [preferences.zoom]);

  useEffect(() => {
    document.documentElement.lang = preferences.language;
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.accent = preferences.accent;
    localStorage.setItem("swiftforge.preferences", JSON.stringify(preferences));
    const light = preferences.theme === "light";
    editor.setTheme(preferences.syntaxTheme === "contrast"
      ? (light ? "hc-light" : "hc-black")
      : (light ? lightWorkbenchTheme : workbenchTheme));
    instance.current?.updateOptions({
      fontSize: preferences.fontSize, lineHeight: Math.round(preferences.fontSize * 1.55),
      lineNumbers: preferences.lineNumbers ? "on" : "off",
      wordWrap: preferences.wrap ? "on" : "off", minimap: { enabled: preferences.minimap, renderCharacters: false, showSlider: "always", maxColumn: 85 },
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

  const build = useBuild(t, root, () => {
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
    await invoke("device_logs_stop");
    await invoke("terminal_stop");
    setTerminalVisible(false);
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
    setEntryParent("");
    setFolders(new Map());
    setExpanded(new Set());
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

  useEffect(() => {
    if (!fileMenu) return;
    fileMenuRef.current?.querySelector("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFileMenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [fileMenu]);

  useEffect(() => {
    if (!isTauri()) return;
    let saved: { root?: string; tabs?: string[]; active?: string };
    try { saved = JSON.parse(localStorage.getItem("swiftforge.session") ?? "{}") ?? {}; }
    catch { saved = {}; }
    if (typeof saved.root !== "string") {
      setSessionRestored(true);
      return;
    }
    const savedRoot = saved.root;
    void run(async () => {
      try {
        const path = await invoke<string>("restore_workspace", { path: savedRoot });
        await adoptProject(path);
        const paths = Array.isArray(saved.tabs) ? saved.tabs.filter(item => typeof item === "string") : [];
        for (const file of paths) {
          try { await openFile(path, file); }
          catch { /* A previously open file may have been moved or deleted. */ }
        }
        if (saved.active && documents.current.has(saved.active)) setActive(saved.active);
      } finally {
        setSessionRestored(true);
      }
    });
  }, []);

  useEffect(() => {
    if (sessionRestored) localStorage.setItem("swiftforge.session", JSON.stringify({ root, tabs, active }));
  }, [sessionRestored, root, tabs, active]);

  function showFileMenu(event: MouseEvent, entry: Entry) {
    event.preventDefault();
    if (busy) return;
    setFileMenu({ entry, x: Math.max(4, Math.min(event.clientX, innerWidth - 239)),
      y: Math.max(4, Math.min(event.clientY, innerHeight - 192)) });
  }

  function refreshExplorer() {
    if (!root) return;
    void run(async () => {
      const next = new Map<string, Entry[]>();
      async function refresh(path: string) {
        const children = await invoke<Entry[]>("list_directory", { root, path });
        next.set(path, children);
        for (const child of children) {
          if (child.directory && folders.has(child.path)) await refresh(child.path);
        }
      }
      await refresh("");
      setFolders(next);
      setExpanded(previous => new Set([...previous].filter(path => next.has(path))));
      if (entryParent && !next.has(entryParent)) setEntryParent("");
    });
  }

  async function createEntry(name: string) {
    if (!root || !newEntry) return;
    const path = entryParent ? entryParent + "/" + name : name;
    await invoke("create_entry", { root, parent: entryParent, name, directory: newEntry === "folder" });
    await run(async () => {
      const entries = await invoke<Entry[]>("list_directory", { root, path: entryParent });
      setFolders(previous => new Map(previous).set(entryParent, entries));
      setExpanded(previous => {
        const next = new Set(previous);
        let ancestor = "";
        for (const part of entryParent.split("/").filter(Boolean)) {
          ancestor = ancestor ? ancestor + "/" + part : part;
          next.add(ancestor);
        }
        return next;
      });
      setGitRevision(value => value + 1);
      if (newEntry === "file") await openFile(root, path);
    });
  }

  function select(entry: Entry, leaf: Entry) {
    if (!root) return;
    void run(async () => {
      setEntryParent(leaf.directory ? leaf.path : leaf.path.split("/").slice(0, -1).join("/"));
      if (entry.directory) {
        const open = new Set(expanded);
        if (open.delete(entry.path)) {
          setExpanded(open);
          return;
        }
        const next = new Map(folders);
        let path = entry.path;
        while (true) {
          const children = await invoke<Entry[]>("list_directory", { root, path });
          next.set(path, children);
          if (children.length !== 1 || !children[0].directory) break;
          path = children[0].path;
        }
        open.add(entry.path);
        setEntryParent(path);
        setFolders(next);
        setExpanded(open);
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

  function save(all = false) {
    if (!root) return;
    const paths = all ? tabs.filter(dirty) : active && dirty(active) ? [active] : [];
    if (!paths.length) return;
    void run(async () => {
      for (const path of paths) {
        const doc = documents.current.get(path)!;
        const text = doc.model.getValue(undefined, true);
        await invoke("save_document", { root, path, text, previous: doc.diskText });
        doc.diskText = text;
        doc.saved = text;
        setGitRevision(value => value + 1);
        redraw(value => value + 1);
      }
    });
  }

  function toggleTerminal() {
    if (!root) return;
    if (!terminalVisible) build.setVisible(false);
    setTerminalVisible(!terminalVisible);
  }

  function changeZoom(step: number) {
    setPreferences(value => {
      const index = zoomLevels.indexOf(value.zoom);
      const zoom = step === 0 ? 100 : zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, index + step))];
      return zoom === value.zoom ? value : { ...value, zoom };
    });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        changeZoom(event.key === "0" ? 0 : event.key === "-" ? -1 : 1);
        return;
      }
      if (newProject || cloneProject || settings || newEntry) return;
      if (event.shiftKey) {
        if (event.code === "KeyB" && root) {
          event.preventDefault();
          if (!event.repeat) void build.build();
        } else if (event.code === "KeyS") {
          event.preventDefault();
          if (!event.repeat) save(true);
        }
        return;
      }
      if (event.code === "KeyF" && active && !host.current?.contains(event.target as Node)) {
        event.preventDefault();
        void instance.current?.getAction("actions.find")?.run();
        return;
      }
      switch (event.code) {
        case "Backquote":
          event.preventDefault();
          if (!event.repeat) toggleTerminal();
          break;
        case "Comma":
          event.preventDefault();
          setSettings(true);
          break;
        case "KeyW":
          if (!active) break;
          event.preventDefault();
          if (!event.repeat) close(active);
          break;
        case "KeyS":
          event.preventDefault();
          save();
          break;
        case "KeyN":
          event.preventDefault();
          if (!event.repeat) startNewProject();
          break;
        case "KeyO":
          event.preventDefault();
          if (!event.repeat) openProject();
          break;
        case "KeyB":
          event.preventDefault();
          if (!event.repeat) toggleSidebar(activeSidebar);
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
    activeLanguage === "plaintext" ? t("Plain text") :
    activeLanguage === "markdown" ? "Markdown" : activeLanguage?.toUpperCase();
  const layout = {
    "--explorer-width": showExplorer ? `min(30vw, ${explorerWidth}px)` : "0px",
    "--phone-width": showPhone ? `min(34vw, ${phoneWidth}px)` : "0px",
  } as CSSProperties;
  const resizeExplorer = (width: number) => setExplorerWidth(Math.max(160, Math.min(384, width)));
  const resizePhone = (width: number) => setPhoneWidth(Math.max(224, Math.min(480, width)));

  return (
    <Locale.Provider value={t}>
    <main className="app" data-device-mode={deviceMode && showPhone} style={layout}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark"><CodeIcon size={18} weight="bold" aria-hidden /></span>
          <span>SwiftForge</span>
        </div>
        <WorkbenchMenu groups={[
          { label: t("File"), items: [
            { name: t("New project"), shortcut: "Ctrl+N", run: startNewProject },
            { name: t("Open folder"), shortcut: "Ctrl+O", run: openProject },
            { name: t("Save"), shortcut: "Ctrl+S", enabled: edited, run: () => save() },
            { name: t("Save all"), shortcut: "Ctrl+Shift+S", enabled: tabs.some(dirty), run: () => save(true) },
            { name: t("Close tab"), shortcut: "Ctrl+W", enabled: !!active, run: () => { if (active) close(active); } },
            { name: t("Settings"), shortcut: "Ctrl+,", run: () => setSettings(true) },
          ] },
          { label: t("Edit"), items: [
            { name: t("Undo"), shortcut: "Ctrl+Z", enabled: !!active, run: () => instance.current?.trigger("menu", "undo", null) },
            { name: t("Redo"), shortcut: "Ctrl+Y", enabled: !!active, run: () => instance.current?.trigger("menu", "redo", null) },
            { name: t("Command palette"), shortcut: "F1", enabled: !!active,
              run: () => void instance.current?.getAction("editor.action.quickCommand")?.run() },
            { name: t("Peek definition"), shortcut: "Ctrl+Shift+F10", enabled: activeLanguage === "swift",
              run: () => {
                instance.current?.focus();
                instance.current?.trigger("menu", "editor.action.peekDefinition", null);
              } },
            { name: t("Duplicate line"), shortcut: "Ctrl+D", enabled: !!active,
              run: () => void instance.current?.getAction("editor.action.copyLinesDownAction")?.run() },
            { name: t("Toggle line comment"), shortcut: "Ctrl+/", enabled: !!active,
              run: () => void instance.current?.getAction("editor.action.commentLine")?.run() },
            { name: t("Find"), shortcut: "Ctrl+F", enabled: !!active, run: () => void instance.current?.getAction("actions.find")?.run() },
          ] },
          { label: t("View"), items: [
            { name: t("Show editor minimap"), run: () => setPreferences(value => ({ ...value, minimap: !value.minimap })) },
            { name: t("Wrap long lines"), run: () => setPreferences(value => ({ ...value, wrap: !value.wrap })) },
            { name: t("Zoom in"), shortcut: "Ctrl++", enabled: preferences.zoom < zoomLevels.at(-1)!, run: () => changeZoom(1) },
            { name: t("Zoom out"), shortcut: "Ctrl+−", enabled: preferences.zoom > zoomLevels[0], run: () => changeZoom(-1) },
            { name: t("Reset zoom"), shortcut: "Ctrl+0", enabled: preferences.zoom !== 100, run: () => changeZoom(0) },
            { name: showExplorer ? t("Hide Explorer") : t("Show Explorer"), shortcut: "Ctrl+B", run: () => setShowExplorer(!showExplorer) },
            { name: showPhone ? t("Hide iPhone") : t("Show iPhone"), run: () => { setDeviceMode(false); setShowPhone(!showPhone); } },
            { name: build.visible ? t("Hide build output") : t("Show build output"), run: () => build.setVisible(!build.visible) },
            { name: terminalVisible ? t("Hide terminal") : t("Show terminal"), shortcut: "Ctrl+`", enabled: !!root, run: toggleTerminal },
          ] },
          { label: t("Build"), items: [
            { name: t("Build IPA"), shortcut: "Ctrl+Shift+B", enabled: !!root && !build.running, run: () => void build.build() },
            { name: t("Export IPA"), enabled: !!build.artifact, run: () => void build.exportIPA() },
            { name: t("Check toolchain"), run: () => void build.check() },
          ] },
          { label: "GitHub", items: [
            { name: t("Clone repository"), run: () => { if (canSwitch()) setCloneProject(true); } },
            { name: t("Repository status"), enabled: !!root, run: () => void run(async () => {
              build.setVisible(true);
              build.write(await invoke<string>("github_status", { root }));
            }) },
            { name: t("Open origin on GitHub"), enabled: !!root, run: () => void run(async () => {
              await invoke("github_open", { root });
            }) },
          ] },
        ]} />
        <div className="toolbar-settings">
          <button className="icon-button" aria-label={t("Switch appearance")} title={t("Switch appearance")}
            onClick={() => setPreferences(value => ({ ...value, theme: value.theme === "dark" ? "light" : "dark" }))}>
            {preferences.theme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
          </button>
          <button className="icon-button" aria-label={t("Settings")} title={t("Settings") + " · Ctrl+,"}
            onClick={() => setSettings(true)}><GearSixIcon size={19} /></button>
        </div>
      </header>

      <section className="command-bar" aria-label={t("Build controls")}>
        {build.controls}
        <div className="project-actions">
          <button className="action" onClick={startNewProject} disabled={busy} title={t("New project") + " · Ctrl+N"}>
            <PlusIcon size={17} aria-hidden /><span>{t("New project")}</span>
          </button>
          <button className="action" onClick={openProject} disabled={busy} title={t("Open folder") + " · Ctrl+O"}>
            <FolderOpenIcon size={17} aria-hidden /><span>{t("Open folder")}</span>
          </button>
          <button className="action" onClick={() => save()} disabled={busy || !edited} title={t("Save") + " · Ctrl+S"}>
            <FloppyDiskIcon size={17} aria-hidden /><span>{t("Save")}</span>
          </button>
        </div>
        <div className="workbench-modes" role="group" aria-label={t("Workspace layout")}>
          <button className="action" aria-label={t("Code")} title={t("Code")} aria-pressed={!showPhone}
            onClick={() => { setShowPhone(false); setDeviceMode(false); }}><CodeIcon size={16} /><span>{t("Code")}</span></button>
          <button className="action" aria-label={t("Split view")} title={t("Split view")} aria-pressed={showPhone && !deviceMode}
            onClick={() => { setShowPhone(true); setDeviceMode(false); }}><ArrowsLeftRightIcon size={16} /><span>{t("Split view")}</span></button>
          <button className="action" aria-label={t("Device")} title={t("Device")} aria-pressed={showPhone && deviceMode}
            onClick={() => { setShowPhone(true); setDeviceMode(true); }}><DeviceMobileIcon size={16} /><span>{t("Device")}</span></button>
        </div>
        {project && <span className="command-target" title={root ?? undefined}>
          <DeviceMobileIcon size={16} aria-hidden /><span>{project}</span><span>iOS · arm64</span>
        </span>}
      </section>

      <nav className="activity-rail" aria-label={t("Workspace tools")}>
        <ExplorerButton visible={showExplorer && activeSidebar === "explorer"} onClick={() => toggleSidebar("explorer")} />
        <button className="rail-action" aria-label={t("GitHub and source control")} title={t("GitHub and source control")}
          aria-pressed={showExplorer && activeSidebar === "github"} onClick={() => toggleSidebar("github")}>
          <GithubLogoIcon size={21} />
        </button>
        <button className="rail-action" aria-label={t("Find in current file")} title={t("Find in current file") + " · Ctrl+F"}
          disabled={!active} onClick={() => void instance.current?.getAction("actions.find")?.run()}>
          <MagnifyingGlassIcon size={21} aria-hidden />
        </button>
        <button className="rail-action" aria-label={t("Toggle build output")} title={t("Build output")} aria-pressed={build.visible}
          onClick={() => build.setVisible(!build.visible)}><TerminalWindowIcon size={21} aria-hidden /></button>
        <button className="rail-action" aria-label={t("Toggle terminal")} title={t("Project terminal")} aria-pressed={terminalVisible}
          disabled={!root} onClick={toggleTerminal}><TerminalIcon size={21} aria-hidden /></button>
        <button className="rail-action device-toggle" aria-label={t("Toggle iPhone panel")} aria-controls="iphone-preview"
          title={mirrorActive ? t("iPhone preview · receiver active") : t("iPhone preview")} aria-pressed={showPhone}
          data-active={mirrorActive} onClick={() => { setDeviceMode(false); setShowPhone(value => !value); }}>
          <DeviceMobileIcon size={21} aria-hidden />
        </button>
      </nav>

      <aside aria-label={t("Project files")} id="project-explorer" className="explorer" hidden={!showExplorer || activeSidebar !== "explorer"}>
        <div className="panel-heading">
          <h2>{t("Explorer")}</h2>
          <div className="explorer-actions">
            <button className="icon-button" disabled={!root || busy} onClick={() => setNewEntry("file")}
              aria-label={t("New file")} title={t("New file")}><FilePlusIcon size={16} /></button>
            <button className="icon-button" disabled={!root || busy} onClick={() => setNewEntry("folder")}
              aria-label={t("New folder")} title={t("New folder")}><FolderPlusIcon size={16} /></button>
            <button className="icon-button" disabled={!root || busy} onClick={refreshExplorer}
              aria-label={t("Refresh files")} title={t("Refresh files")}><ArrowClockwiseIcon size={16} /></button>
            <button className="icon-button" onClick={() => setExpanded(new Set())} disabled={busy || expanded.size === 0}
              aria-label={t("Collapse all folders")} title={t("Collapse all folders")}><ArrowsInLineVerticalIcon size={16} aria-hidden /></button>
            <button className="icon-button" onClick={openProject} disabled={busy} aria-label={t("Open project folder")} title={t("Open project folder")}>
              <FolderOpenIcon size={17} aria-hidden />
            </button>
          </div>
        </div>
        {root && <>
          <button className="project-root explorer-root" title={root} aria-pressed={!entryParent} onClick={() => setEntryParent("")}
            onContextMenu={event => showFileMenu(event, { name: project ?? "", path: "", directory: true })}><FolderOpenIcon size={15} aria-hidden /><span>{project}</span></button>
          <FileTree path="" folders={folders} expanded={expanded} active={active} onSelect={select} onContext={showFileMenu} />
        </>}
      </aside>
      {activeSidebar === "github" && <aside className="explorer" aria-label={t("GitHub workspace")} hidden={!showExplorer}>
        <GitHubSidebar root={root} revision={gitRevision}
          clone={() => { if (canSwitch()) setCloneProject(true); }}
          open={path => { if (root) void run(() => openFile(root, path)); }} />
      </aside>}
      {showExplorer && <PanelDivider label={t("Resize project explorer")} side="left" width={explorerWidth} onResize={resizeExplorer} />}

      <section className="workspace" aria-label={t("Code workspace")}>
        <nav className="tabs" aria-label={t("Open files")}>
          {tabs.map(path => (
            <div className={path === active ? "tab active" : "tab"} key={path}>
              <button className="tab-file" onClick={() => setActive(path)} aria-current={path === active ? "page" : undefined} title={path}>
                <FileGlyph path={path} /><span>{path.split("/").at(-1)}</span>
                {dirty(path) && <span className="dirty-dot" aria-label={t("unsaved")} />}
              </button>
              <button className="close icon-button" aria-label={t("Close {path}", { path })} title={t("Close tab")} onClick={() => close(path)}>
                <XIcon size={13} aria-hidden />
              </button>
            </div>
          ))}
        </nav>
        {active && <div className="editor-navigation">
          <div className="breadcrumbs" aria-label={t("Current file path")}>
            {[project, ...active.split("/")].filter(Boolean).map((name, index) => (
              <span key={`${index}:${name}`}>{index > 0 && <CaretRightIcon size={11} aria-hidden />}{name}</span>
            ))}
          </div>
          <div className="editor-actions" aria-label={t("Editor commands")}>
            <button className="icon-button editor-toggle" aria-label={t("Show editor minimap")} title={t("Show editor minimap")}
              aria-pressed={preferences.minimap} onClick={() => setPreferences(value => ({ ...value, minimap: !value.minimap }))}>
              <SidebarSimpleIcon size={16} />
            </button>
            <button className="icon-button" aria-label={t("Settings")} title={t("Settings")} onClick={() => setSettings(true)}>
              <GearSixIcon size={16} />
            </button>
            <button className="icon-button" aria-label={t("Find and replace")} title={t("Find and replace") + " · Ctrl+H"}
              onClick={() => void instance.current?.getAction("editor.action.startFindReplaceAction")?.run()}><ArrowsLeftRightIcon size={16} /></button>
            <button className="icon-button" aria-label={t("Go to line")} title={t("Go to line") + " · Ctrl+G"}
              onClick={() => void instance.current?.getAction("editor.action.gotoLine")?.run()}><ListNumbersIcon size={16} /></button>
            <button className="icon-button" aria-label={t("Go to definition")} title={t("Go to definition") + " · F12"} disabled={activeLanguage !== "swift"}
              onClick={() => {
                instance.current?.focus();
                instance.current?.trigger("toolbar", "editor.action.revealDefinition", null);
              }}><ArrowBendRightDownIcon size={16} /></button>
          </div>
        </div>}
        <div className="editor-area">
          <div ref={host} className="editor" aria-hidden={!active} />
          {!active && <div className="empty">
            <div className="empty-symbol"><CodeIcon size={32} aria-hidden /></div>
            <h1>{root ? t("Open a file") : t("Open a Swift project")}</h1>
            <p>{root ? t("Choose a source file in Explorer.") : t("Choose an existing project folder to start editing.")}</p>
            {root && !showExplorer
              ? <button className="action" onClick={() => setShowExplorer(true)}>{t("Show Explorer")}</button>
              : !root && <div className="welcome-actions">
                  <button className="action primary" onClick={startNewProject} disabled={busy}><PlusIcon size={17} /> {t("New project")}</button>
                  <button className="action" onClick={openProject} disabled={busy}><FolderOpenIcon size={17} /> {t("Open folder")}</button>
                </div>}
          </div>}
        </div>
      </section>

      {showPhone && !deviceMode && <PanelDivider label={t("Resize iPhone preview")} side="right" width={phoneWidth} onResize={resizePhone} />}
      <IPhonePanel visible={showPhone} onReceiverChange={setMirrorActive}>
        <DeviceTools key={root ?? ""} artifact={build.artifact} saveIPA={build.exportIPA}
          showOutput={() => build.setVisible(true)} write={build.write} />
      </IPhonePanel>

      <div className="console-dock" hidden={!build.visible && !terminalVisible}>
        {build.panel}
        {root && <TerminalPane key={root} root={root} visible={terminalVisible} hide={() => setTerminalVisible(false)} />}
      </div>

      <footer className={notice ? "status error" : "status"}>
        <span className="status-message" role="status" title={notice || active || root || undefined}>
          {notice ? <WarningCircleIcon size={15} aria-hidden /> : active && !edited && <CheckCircleIcon size={15} aria-hidden />}
          {t(notice) || (busy ? t("Working…") : active ? (edited ? t("Unsaved changes") : t("Saved")) : project || t("No project open"))}
        </span>
        <div className="editor-status">
          {languageStatus && <span title={t(languageStatus)}>{t(languageStatus)}</span>}
          {active && <><span>{t("Ln {line}, Col {column}", { line: cursor.lineNumber, column: cursor.column })}</span>
            <span>UTF-8</span><span>{languageName}</span></>}
        </div>
      </footer>
      {fileMenu && root && <div ref={fileMenuRef} className="file-context" role="group" aria-label={t("File actions")}
        style={{ left: fileMenu.x, top: fileMenu.y }}>
        {(["file", "folder"] as const).map(kind => <button key={kind} onClick={() => {
          const { path, directory } = fileMenu.entry;
          setEntryParent(directory ? path : path.split("/").slice(0, -1).join("/"));
          setFileMenu(null);
          setNewEntry(kind);
        }}>{t(kind === "file" ? "New file" : "New folder")}</button>)}
        <button onClick={() => {
          setFileMenu(null);
          void run(() => invoke("reveal_entry", { root, path: fileMenu.entry.path }));
        }}>{t("Show in file manager")}</button>
        {[false, true].map(relative => <button key={String(relative)} onClick={() => {
          setFileMenu(null);
          const { path } = fileMenu.entry;
          void run(() => navigator.clipboard.writeText(relative ? path || "." : path ? root + "/" + path : root));
        }}>{t(relative ? "Copy relative path" : "Copy full path")}</button>)}
      </div>}
      {newEntry && root && <CreateEntryDialog folder={newEntry === "folder"} parent={entryParent || root}
        create={createEntry} close={() => setNewEntry(null)} />}
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
    </Locale.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

import { useLocale, type InterfaceLanguage } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, CodeIcon, FolderOpenIcon, GithubLogoIcon, MoonIcon, PaintBrushIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const accents = ["orange", "blue", "violet", "green"] as const;
export const syntaxThemes = ["auto", "contrast"] as const;

export interface Preferences {
  accent: typeof accents[number];
  syntaxTheme: typeof syntaxThemes[number];
  lineNumbers: boolean;
  theme: "dark" | "light";
  language: InterfaceLanguage;
  zoom: number;
  fontSize: number;
  tabSize: number;
  wrap: boolean;
  minimap: boolean;
}

export const zoomLevels = [80, 90, 100, 110, 125, 150, 175];

export const defaultPreferences: Preferences = { theme: "dark", accent: "orange", syntaxTheme: "auto", lineNumbers: true, language: "en", zoom: 100, fontSize: 14, tabSize: 4, wrap: false, minimap: true };
export function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem("swiftforge.preferences") ?? "{}");
    return {
      accent: accents.includes(value.accent) ? value.accent : "orange",
      syntaxTheme: value.syntaxTheme === "contrast" || value.syntaxTheme === "hc-black" || value.syntaxTheme === "hc-light" ? "contrast" : "auto",
      lineNumbers: value.lineNumbers !== false,
      language: value.language === "ru" ? "ru" : "en",
      zoom: zoomLevels.includes(value.zoom) ? value.zoom : 100,
      theme: value.theme === "light" ? "light" : "dark",
      fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 11 && value.fontSize <= 26 ? value.fontSize : 14,
      tabSize: [2, 4, 8].includes(value.tabSize) ? value.tabSize : 4,
      wrap: value.wrap === true,
      minimap: value.minimap !== false,
    };
  } catch {
    return defaultPreferences;
  }
}

export type MenuItem = { name: string; shortcut?: string; enabled?: boolean; run: () => void };

export function WorkbenchMenu({ groups }: { groups: { label: string; items: MenuItem[] }[] }) {
  const t = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const menu = useRef<HTMLElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node)) setOpen(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  return <nav ref={menu} className="workbench-menu" aria-label={t("Application menu")}>
    {groups.map(group => <div className="menu-group" key={group.label}>
      <button onClick={() => setOpen(open === group.label ? null : group.label)} aria-expanded={open === group.label}>{group.label}</button>
      {open === group.label && <div className="menu-popup">
        {group.items.map(item => <button key={item.name} disabled={item.enabled === false} onClick={() => {
          setOpen(null);
          item.run();
        }}><span>{item.name}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}
      </div>}
    </div>)}
  </nav>;
}

function WorkbenchDialog({ title, close, busy = false, className = "", children }: {
  title: string; close: () => void; busy?: boolean; className?: string; children: ReactNode;
}) {
  const t = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return <dialog ref={dialog} className={`workbench-dialog ${className}`} aria-label={title} onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <div className="dialog-heading"><h1>{title}</h1>
      <button type="button" className="icon-button" aria-label={t("Close dialog")} disabled={busy} onClick={close}><XIcon size={16} /></button>
    </div>
    {children}
  </dialog>;
}

export function CreateEntryDialog({ folder, parent, close, create }: {
  folder: boolean; parent: string; close: () => void; create: (name: string) => Promise<void>;
}) {
  const t = useLocale();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <WorkbenchDialog title={t(folder ? "New folder" : "New file")} close={close} busy={busy}>
    <form className="settings-fields" onSubmit={async event => {
      event.preventDefault();
      if (busy || !name.trim()) return;
      setBusy(true);
      setError("");
      try { await create(name.trim()); close(); }
      catch (problem) { setError(t(String(problem))); }
      finally { setBusy(false); }
    }}>
      <label>{t("Name")}<input autoFocus required value={name} onChange={event => setName(event.target.value)} /></label>
      <code className="entry-parent" title={parent}>{parent}</code>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="action" type="button" disabled={busy} onClick={close}>{t("Cancel")}</button>
        <button className="action primary" type="submit" disabled={busy || !name.trim()}>{t("Create")}</button>
      </div>
    </form>
  </WorkbenchDialog>;
}

export function Settings({ value, change, close }: {
  value: Preferences; change: (value: Preferences) => void; close: () => void;
}) {
  const t = useLocale();
  const [section, setSection] = useState<"appearance" | "editor">("appearance");
  return <WorkbenchDialog title={t("Settings")} close={close} className="preferences-dialog">
    <nav className="preferences-nav" aria-label={t("Settings sections")}>
      <button type="button" aria-pressed={section === "appearance"} onClick={() => setSection("appearance")}>
        <PaintBrushIcon size={16} aria-hidden /> {t("Appearance")}
      </button>
      <button type="button" aria-pressed={section === "editor"} onClick={() => setSection("editor")}>
        <CodeIcon size={16} aria-hidden /> {t("Editor")}
      </button>
    </nav>
    <div className="preferences-content">
      {section === "appearance" ? <>
        <div className="preference-row">
          <span>{t("Interface theme")}</span>
          <div className="theme-picker" role="group" aria-label={t("Interface theme")}>
            <button aria-pressed={value.theme === "dark"} onClick={() => change({ ...value, theme: "dark" })}>
              <MoonIcon size={15} aria-hidden /> {t("Dark")}
            </button>
            <button aria-pressed={value.theme === "light"} onClick={() => change({ ...value, theme: "light" })}>
              <SunIcon size={15} aria-hidden /> {t("Light")}
            </button>
          </div>
        </div>
        <div className="preference-row">
          <span>{t("Accent color")}</span>
          <div className="accent-picker" role="group" aria-label={t("Accent color")}>
            {accents.map((accent, index) => {
              const label = t(["Orange", "Blue", "Violet", "Green"][index]);
              return <button key={accent} data-swatch={accent} aria-label={label} title={label}
                aria-pressed={value.accent === accent} onClick={() => change({ ...value, accent })}>
                {value.accent === accent && <CheckIcon size={14} weight="bold" aria-hidden />}
              </button>;
            })}
          </div>
        </div>
        <label className="preference-row">{t("Interface language")}<select value={value.language}
          onChange={event => change({ ...value, language: event.target.value === "ru" ? "ru" : "en" })}>
          <option value="en" lang="en">English</option><option value="ru" lang="ru">Русский</option>
        </select></label>
        <label className="preference-row">{t("Interface zoom")}<select value={value.zoom}
          onChange={event => change({ ...value, zoom: Number(event.target.value) })}>
          {zoomLevels.map(zoom => <option key={zoom} value={zoom}>{zoom}%</option>)}
        </select></label>
      </> : <>
        <label className="preference-row">{t("Code color theme")}<select value={value.syntaxTheme}
          onChange={event => change({ ...value, syntaxTheme: event.target.value === "contrast" ? "contrast" : "auto" })}>
          {syntaxThemes.map((theme, index) => <option key={theme} value={theme}>{t(["Match interface", "High contrast"][index])}</option>)}
        </select></label>
        <label className="preference-row">{t("Editor font size")}<select value={value.fontSize}
          onChange={event => change({ ...value, fontSize: Number(event.target.value) })}>
          {Array.from({ length: 16 }, (_, index) => index + 11).map(size => <option key={size} value={size}>{size} px</option>)}
        </select></label>
        <label className="preference-row">{t("Indentation")}<select value={value.tabSize}
          onChange={event => change({ ...value, tabSize: Number(event.target.value) })}>
          <option value={2}>{t("2 spaces")}</option><option value={4}>{t("4 spaces")}</option><option value={8}>{t("8 spaces")}</option>
        </select></label>
        <label className="preference-row">{t("Show line numbers")}<input type="checkbox" role="switch" checked={value.lineNumbers}
          onChange={event => change({ ...value, lineNumbers: event.target.checked })} /></label>
        <label className="preference-row">{t("Wrap long lines")}<input type="checkbox" role="switch" checked={value.wrap}
          onChange={event => change({ ...value, wrap: event.target.checked })} /></label>
        <label className="preference-row">{t("Show editor minimap")}<input type="checkbox" role="switch" checked={value.minimap}
          onChange={event => change({ ...value, minimap: event.target.checked })} /></label>
      </>}
    </div>
    <div className="dialog-actions preferences-footer">
      <button className="action" onClick={() => change(defaultPreferences)}>{t("Restore defaults")}</button>
      <button className="action primary" onClick={close}>{t("Done")}</button>
    </div>
  </WorkbenchDialog>;
}

export function GitHubClone({ close, opened }: { close: () => void; opened: (root: string) => Promise<void> }) {
  const t = useLocale();
  const [repository, setRepository] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <WorkbenchDialog title={t("Clone from GitHub")} close={close} busy={busy}>
    <form className="settings-fields" onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        await opened(await invoke<string>("github_clone", { repository, parent }));
      } catch (problem) {
        setError(String(problem));
      } finally {
        setBusy(false);
      }
    }}>
      <label>{t("Repository")}<input required autoFocus value={repository} onChange={event => setRepository(event.target.value)} placeholder="owner/repository" /></label>
      <label>{t("Location")}<span className="location-field">
        <input required value={parent} onChange={event => setParent(event.target.value)} placeholder="/home/you/Projects" />
        <button type="button" className="action" disabled={busy} onClick={async () => {
          try {
            const path = await invoke<string | null>("choose_directory");
            if (path) setParent(path);
          } catch (problem) {
            setError(String(problem));
          }
        }}><FolderOpenIcon size={16} /> {t("Browse")}</button>
      </span></label>
      {error && <p role="alert" className="status error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="action" disabled={busy} onClick={close}>{t("Cancel")}</button>
        <button className="action primary" disabled={busy || !repository || !parent} type="submit"><GithubLogoIcon size={16} /> {busy ? t("Cloning…") : t("Clone and open")}</button>
      </div>
    </form>
  </WorkbenchDialog>;
}

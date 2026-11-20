import { useLocale, type InterfaceLanguage } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpenIcon, GithubLogoIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const accents = ["orange", "blue", "violet", "green"] as const;
export const syntaxThemes = ["auto", "vs", "vs-dark", "hc-black", "hc-light"] as const;

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
      syntaxTheme: syntaxThemes.includes(value.syntaxTheme) ? value.syntaxTheme : "auto",
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

function WorkbenchDialog({ title, close, busy = false, children }: {
  title: string; close: () => void; busy?: boolean; children: ReactNode;
}) {
  const t = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return <dialog ref={dialog} className="workbench-dialog" aria-label={title} onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <div className="dialog-heading"><h1>{title}</h1>
      <button type="button" className="icon-button" aria-label={t("Close dialog")} disabled={busy} onClick={close}><XIcon size={16} /></button>
    </div>
    {children}
  </dialog>;
}

export function Settings({ value, change, close }: {
  value: Preferences; change: (value: Preferences) => void; close: () => void;
}) {
  const t = useLocale();
  return <WorkbenchDialog title={t("Settings")} close={close}>
    <div className="settings-fields">
      <label>{t("Interface language")}<select value={value.language}
        onChange={event => change({ ...value, language: event.target.value === "ru" ? "ru" : "en" })}>
        <option value="en" lang="en">English</option><option value="ru" lang="ru">Русский</option>
      </select></label>
      <label>{t("Interface zoom")}<select value={value.zoom}
        onChange={event => change({ ...value, zoom: Number(event.target.value) })}>
        {zoomLevels.map(zoom => <option key={zoom} value={zoom}>{zoom}%</option>)}
      </select></label>
      <label>{t("Appearance")}<select value={value.theme} onChange={event => change({ ...value, theme: event.target.value === "light" ? "light" : "dark" })}>
        <option value="dark">Forge Dark</option><option value="light">Studio Light</option>
      </select></label>
      <label>{t("Accent color")}<select value={value.accent}
        onChange={event => change({ ...value, accent: event.target.value as Preferences["accent"] })}>
        {accents.map((accent, index) => <option key={accent} value={accent}>{t(["Orange", "Blue", "Violet", "Green"][index])}</option>)}
      </select></label>
      <label>{t("Code color theme")}<select value={value.syntaxTheme}
        onChange={event => change({ ...value, syntaxTheme: event.target.value as Preferences["syntaxTheme"] })}>
        {syntaxThemes.map((theme, index) => <option key={theme} value={theme}>{t(["Match interface", "Light", "Dark", "High contrast dark", "High contrast light"][index])}</option>)}
      </select></label>
      <label className="checkbox-label"><input type="checkbox" checked={value.lineNumbers}
        onChange={event => change({ ...value, lineNumbers: event.target.checked })} /> {t("Show line numbers")}</label>
      <label>{t("Editor font size")}<input type="number" min={11} max={26} value={value.fontSize} onChange={event => {
        const number = Number(event.target.value);
        if (number >= 11 && number <= 26) change({ ...value, fontSize: number });
      }} /></label>
      <label>{t("Indentation")}<select value={value.tabSize} onChange={event => change({ ...value, tabSize: Number(event.target.value) })}>
        <option value={2}>{t("2 spaces")}</option><option value={4}>{t("4 spaces")}</option><option value={8}>{t("8 spaces")}</option>
      </select></label>
      <label className="checkbox-label"><input type="checkbox" checked={value.wrap} onChange={event => change({ ...value, wrap: event.target.checked })} /> {t("Wrap long lines")}</label>
      <label className="checkbox-label"><input type="checkbox" checked={value.minimap} onChange={event => change({ ...value, minimap: event.target.checked })} /> {t("Show editor minimap")}</label>
      <div className="dialog-actions">
        <button className="action" onClick={() => change(defaultPreferences)}>{t("Restore defaults")}</button>
        <button className="action primary" onClick={close}>{t("Done")}</button>
      </div>
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

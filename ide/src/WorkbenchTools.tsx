import { invoke } from "@tauri-apps/api/core";
import { FolderOpenIcon, GithubLogoIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface Preferences {
  theme: "dark" | "light";
  fontSize: number;
  tabSize: number;
  wrap: boolean;
  minimap: boolean;
}

export const defaultPreferences: Preferences = { theme: "dark", fontSize: 14, tabSize: 4, wrap: false, minimap: false };
export function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem("swiftforge.preferences") ?? "{}");
    return {
      theme: value.theme === "light" ? "light" : "dark",
      fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 11 && value.fontSize <= 26 ? value.fontSize : 14,
      tabSize: [2, 4, 8].includes(value.tabSize) ? value.tabSize : 4,
      wrap: value.wrap === true,
      minimap: value.minimap === true,
    };
  } catch {
    return defaultPreferences;
  }
}

export type MenuItem = { name: string; shortcut?: string; enabled?: boolean; run: () => void };

export function WorkbenchMenu({ groups }: { groups: { label: string; items: MenuItem[] }[] }) {
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
  return <nav ref={menu} className="workbench-menu" aria-label="Application menu">
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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return <dialog ref={dialog} className="workbench-dialog" aria-label={title} onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <div className="dialog-heading"><h1>{title}</h1>
      <button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}><XIcon size={16} /></button>
    </div>
    {children}
  </dialog>;
}

export function Settings({ value, change, close }: {
  value: Preferences; change: (value: Preferences) => void; close: () => void;
}) {
  return <WorkbenchDialog title="Settings" close={close}>
    <div className="settings-fields">
      <label>Appearance<select value={value.theme} onChange={event => change({ ...value, theme: event.target.value === "light" ? "light" : "dark" })}>
        <option value="dark">Forge Dark</option><option value="light">Studio Light</option>
      </select></label>
      <label>Editor font size<input type="number" min={11} max={26} value={value.fontSize} onChange={event => {
        const number = Number(event.target.value);
        if (number >= 11 && number <= 26) change({ ...value, fontSize: number });
      }} /></label>
      <label>Indentation<select value={value.tabSize} onChange={event => change({ ...value, tabSize: Number(event.target.value) })}>
        <option value={2}>2 spaces</option><option value={4}>4 spaces</option><option value={8}>8 spaces</option>
      </select></label>
      <label className="checkbox-label"><input type="checkbox" checked={value.wrap} onChange={event => change({ ...value, wrap: event.target.checked })} /> Wrap long lines</label>
      <label className="checkbox-label"><input type="checkbox" checked={value.minimap} onChange={event => change({ ...value, minimap: event.target.checked })} /> Show editor minimap</label>
      <div className="dialog-actions">
        <button className="action" onClick={() => change(defaultPreferences)}>Restore defaults</button>
        <button className="action primary" onClick={close}>Done</button>
      </div>
    </div>
  </WorkbenchDialog>;
}

export function GitHubClone({ close, opened }: { close: () => void; opened: (root: string) => Promise<void> }) {
  const [repository, setRepository] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <WorkbenchDialog title="Clone from GitHub" close={close} busy={busy}>
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
      <label>Repository<input required autoFocus value={repository} onChange={event => setRepository(event.target.value)} placeholder="owner/repository" /></label>
      <label>Location<span className="location-field">
        <input required value={parent} onChange={event => setParent(event.target.value)} placeholder="/home/you/Projects" />
        <button type="button" className="action" disabled={busy} onClick={async () => {
          try {
            const path = await invoke<string | null>("choose_directory");
            if (path) setParent(path);
          } catch (problem) {
            setError(String(problem));
          }
        }}><FolderOpenIcon size={16} /> Browse</button>
      </span></label>
      {error && <p role="alert" className="status error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="action" disabled={busy} onClick={close}>Cancel</button>
        <button className="action primary" disabled={busy || !repository || !parent} type="submit"><GithubLogoIcon size={16} /> {busy ? "Cloning…" : "Clone and open"}</button>
      </div>
    </form>
  </WorkbenchDialog>;
}

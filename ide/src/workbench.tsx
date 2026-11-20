import { useLocale } from "./i18n";
import {
  CaretRightIcon, CodeIcon, FileCodeIcon, FileTextIcon, FolderIcon, FolderOpenIcon, ImageIcon, PackageIcon, TranslateIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { editor } from "monaco-editor/esm/vs/editor/editor.api.js";

export const workbenchTheme = "swiftforge";
export const lightWorkbenchTheme = "swiftforge-light";

editor.defineTheme(workbenchTheme, {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8F9A88" },
    { token: "keyword", foreground: "E5A4C4" },
    { token: "string", foreground: "BED49F" },
    { token: "number", foreground: "EDB789" },
    { token: "type.identifier", foreground: "9ECBD0" },
  ],
  colors: {
    "editor.background": "#161621",
    "editor.foreground": "#EEEDF9",
    "editorGutter.background": "#161621",
    "editorLineNumber.foreground": "#8D8BA7",
    "editorLineNumber.activeForeground": "#F0B28D",
    "editor.lineHighlightBackground": "#202032",
    "editor.selectionBackground": "#594139",
    "editor.inactiveSelectionBackground": "#473331",
    "editorCursor.foreground": "#F1AB83",
    "editorIndentGuide.background1": "#29283B",
    "editorIndentGuide.activeBackground1": "#604D46",
    "editorWidget.background": "#202032",
    "editorWidget.border": "#39364D",
    "editorSuggestWidget.selectedBackground": "#473331",
    "editorOverviewRuler.border": "#161621",
    "minimap.background": "#1c1c2a",
    "minimapSlider.background": "#77749038",
    "minimapSlider.hoverBackground": "#77749065",
  },
});

editor.defineTheme(lightWorkbenchTheme, {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "52684B" },
    { token: "keyword", foreground: "813371" },
    { token: "string", foreground: "923C25" },
  ],
  colors: {
    "editor.background": "#F8F7FB",
    "editorGutter.background": "#F8F7FB",
    "editor.foreground": "#252235",
    "editorLineNumber.foreground": "#69667C",
    "editor.lineHighlightBackground": "#EFEDF6",
    "editor.selectionBackground": "#DDD3F4",
    "minimap.background": "#EFEDF5",
    "minimapSlider.background": "#77749036",
    "minimapSlider.hoverBackground": "#77749055",
  },
});

export function FileGlyph({ path }: { path: string }) {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "package.swift" || name === "package.resolved") return <PackageIcon className="file-glyph package" size={15} aria-hidden />;
  if (name.endsWith(".swift")) return <CodeIcon className="file-glyph swift" size={15} aria-hidden />;
  if (/\.(?:xcstrings|strings|stringsdict)$/.test(name)) return <TranslateIcon className="file-glyph localization" size={15} aria-hidden />;
  if (/\.(?:png|jpe?g|heic|gif|svg|webp|pdf)$/.test(name)) return <ImageIcon className="file-glyph asset" size={15} aria-hidden />;
  if (/\.(?:json|ya?ml|toml|plist|entitlements|xcconfig)$/.test(name)) return <FileCodeIcon className="file-glyph config" size={15} aria-hidden />;
  return <FileTextIcon className="file-glyph" size={15} aria-hidden />;
}

export function DirectoryGlyph({ expanded, path }: { expanded: boolean; path: string }) {
  return <>
    <CaretRightIcon className={expanded ? "tree-caret expanded" : "tree-caret"} size={12} aria-hidden />
    {/\.(?:xcassets|imageset|appiconset)$/i.test(path)
      ? <ImageIcon className="file-glyph asset" size={16} aria-hidden />
      : expanded ? <FolderOpenIcon className="folder-glyph" size={16} aria-hidden /> : <FolderIcon className="folder-glyph" size={16} aria-hidden />}
  </>;
}

export function PanelDivider({ label, side, width, onResize }: {
  label: string;
  side: "left" | "right";
  width: number;
  onResize: (width: number) => void;
}) {
  return (
    <div className="panel-divider" role="separator" tabIndex={0} aria-label={label} data-side={side}
      aria-orientation="vertical" aria-valuemin={side === "left" ? 160 : 224} aria-valuemax={side === "left" ? 384 : 480} aria-valuenow={width}
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const movement = event.key === "ArrowRight" ? 16 : -16;
        onResize(width + (side === "left" ? movement : -movement));
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const start = event.clientX;
        handle.setPointerCapture(event.pointerId);
        handle.classList.add("dragging");
        const move = (next: PointerEvent) => {
          const delta = next.clientX - start;
          onResize(width + (side === "left" ? delta : -delta));
        };
        const end = () => {
          handle.classList.remove("dragging");
          handle.removeEventListener("pointermove", move);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("lostpointercapture", end, { once: true });
      }}
    />
  );
}

export function ExplorerButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const t = useLocale();
  return (
    <button className="rail-action" aria-label={t("Toggle project explorer")} aria-controls="project-explorer"
      aria-pressed={visible} title={t("Project explorer") + " · Ctrl+B"} onClick={onClick}>
      <SidebarSimpleIcon size={21} aria-hidden />
    </button>
  );
}

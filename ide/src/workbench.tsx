import { useLocale } from "./i18n";
import {
  CaretRightIcon, CodeIcon, FileCodeIcon, FileTextIcon, FolderIcon, FolderOpenIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { editor } from "monaco-editor/esm/vs/editor/editor.api.js";

export const workbenchTheme = "swiftforge";

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
    "editorLineNumber.activeForeground": "#C5AFFF",
    "editor.lineHighlightBackground": "#202032",
    "editor.selectionBackground": "#453269",
    "editor.inactiveSelectionBackground": "#33284D",
    "editorCursor.foreground": "#BAA1FF",
    "editorIndentGuide.background1": "#29283B",
    "editorIndentGuide.activeBackground1": "#4E456D",
    "editorWidget.background": "#202032",
    "editorWidget.border": "#39364D",
    "editorSuggestWidget.selectedBackground": "#33284D",
    "editorOverviewRuler.border": "#161621",
  },
});

export function FileGlyph({ path }: { path: string }) {
  if (path.endsWith(".swift")) return <CodeIcon className="file-glyph swift" size={15} aria-hidden />;
  if (/\.(?:json|ya?ml|toml)$/.test(path)) return <FileCodeIcon className="file-glyph config" size={15} aria-hidden />;
  return <FileTextIcon className="file-glyph" size={15} aria-hidden />;
}

export function DirectoryGlyph({ expanded }: { expanded: boolean }) {
  return <>
    <CaretRightIcon className={expanded ? "tree-caret expanded" : "tree-caret"} size={12} aria-hidden />
    {expanded ? <FolderOpenIcon className="folder-glyph" size={16} aria-hidden /> : <FolderIcon className="folder-glyph" size={16} aria-hidden />}
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

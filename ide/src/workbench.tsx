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
    "editor.background": "#1F1F1F",
    "editor.foreground": "#E9E6E1",
    "editorGutter.background": "#1F1F1F",
    "editorLineNumber.foreground": "#89837D",
    "editorLineNumber.activeForeground": "#F0B28D",
    "editor.lineHighlightBackground": "#272727",
    "editor.selectionBackground": "#634A3E",
    "editor.inactiveSelectionBackground": "#493C37",
    "editorCursor.foreground": "#F1AB83",
    "editorIndentGuide.background1": "#313131",
    "editorIndentGuide.activeBackground1": "#62574C",
    "editorWidget.background": "#272727",
    "editorWidget.border": "#48423D",
    "editorSuggestWidget.selectedBackground": "#493C37",
    "editorOverviewRuler.border": "#1F1F1F",
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

export function PanelDivider({ panel, side, width, onResize }: {
  panel: string;
  side: "left" | "right";
  width: number;
  onResize: (width: number) => void;
}) {
  return (
    <div className="panel-divider" role="separator" tabIndex={0} aria-label={`Resize ${panel}`}
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
  return (
    <button className="rail-action" aria-label="Toggle project explorer" aria-controls="project-explorer"
      aria-pressed={visible} title="Project explorer · Ctrl+B" onClick={onClick}>
      <SidebarSimpleIcon size={21} aria-hidden />
    </button>
  );
}

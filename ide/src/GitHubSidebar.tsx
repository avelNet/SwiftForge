import { useLocale } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { ArrowClockwiseIcon, ArrowSquareOutIcon, GitBranchIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { FileGlyph } from "./workbench";

interface Overview {
  branch: string;
  changes: { path: string; status: string }[];
}

export function GitHubSidebar({ root, revision, clone, open }: {
  root: string | null;
  revision: number;
  clone: () => void;
  open: (path: string) => void;
}) {
  const t = useLocale();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setOverview(null);
    setError("");
    if (root) void invoke<Overview>("github_overview", { root }).then(result => {
      if (current) setOverview(result);
    }).catch(problem => {
      if (current) setError(String(problem).includes("not a git repository") ? "This folder is not a Git repository." : String(problem));
    });
    return () => { current = false; };
  }, [root, revision, refresh]);

  return <>
    <div className="panel-heading">
      <h2><GithubLogoIcon size={16} /> GitHub</h2>
      <button className="icon-button" aria-label={t("Refresh Git status")} title={t("Refresh Git status")} disabled={!root}
        onClick={() => setRefresh(value => value + 1)}><ArrowClockwiseIcon size={16} /></button>
    </div>
    <div className="github-sidebar-tools">
      <button className="action primary" onClick={clone}><GithubLogoIcon size={16} /> {t("Clone repository")}</button>
      {overview && <button className="action" onClick={() => void invoke("github_open", { root }).catch(problem => setError(String(problem)))}>
        <ArrowSquareOutIcon size={16} /> {t("Open origin")}
      </button>}
    </div>
    {overview && <>
      <div className="project-root" title={overview.branch}><GitBranchIcon size={16} /><span>{overview.branch}</span></div>
      <h3 className="github-changes-title">{t("Changes")} <span>{overview.changes.length}</span></h3>
      {overview.changes.length > 0
        ? <ul>{overview.changes.map(change => <li key={change.path}>
          <button className="entry git-change" title={change.path} disabled={change.status.includes("D")} onClick={() => open(change.path)}>
            <FileGlyph path={change.path} /><span className="entry-name">{change.path}</span><span className="git-code">{change.status}</span>
          </button>
        </li>)}</ul>
        : <p className="sidebar-note">{t("Working tree clean.")}</p>}
    </>}
    {error && <p className="sidebar-note" role="status">{t(error)}</p>}
    {!root && <p className="sidebar-note">{t("Open a Git project or clone one from GitHub.")}</p>}
  </>;
}

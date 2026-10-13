import Link from "next/link";
import { Logo } from "@/components/logo";
import { RunList } from "@/components/run-list";
import { listRuns } from "@/lib/runs/store";

export async function Sidebar() {
  const runs = await listRuns();
  const repos = [...new Map(runs.map((r) => [`${r.repo.owner}/${r.repo.name}`, r.repo])).keys()];

  return (
    <aside className="flex w-[252px] flex-none flex-col border-r border-line bg-sidebar">
      <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line px-4">
        <Logo />
        <span className="text-sm font-semibold tracking-[-0.01em]">Trace</span>
      </div>

      <div className="px-3 pt-3 pb-2">
        <Link
          href="/new"
          className="flex h-8 w-full items-center gap-2 rounded-[7px] border border-line-4 bg-raised px-2.5 text-[12.5px] font-medium text-fg hover:border-[#3a3d45] hover:bg-hover"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New bug report
        </Link>
      </div>

      <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
        <span className="eyebrow text-muted">Runs</span>
        <span className="font-mono text-[11px] text-faint">{runs.length}</span>
      </div>
      <RunList
        runs={runs.map((r) => ({ id: r.id, title: r.report.title, status: r.status, createdAt: r.report.createdAt }))}
      />

      <div className="flex flex-none flex-col gap-2.5 border-t border-line px-4 py-3">
        {repos.map((repo) => (
          <div key={repo} className="flex items-center gap-2 text-xs">
            <RepoIcon />
            <span className="font-mono text-fg-2">{repo}</span>
          </div>
        ))}
        <Link href="/settings" className="text-xs text-muted hover:text-fg">
          Settings
        </Link>
      </div>
    </aside>
  );
}

function RepoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 2.5h8.5a1 1 0 011 1v10H4a1 1 0 01-1-1v-10zM3 11.5h9.5"
        stroke="#8A8F98"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

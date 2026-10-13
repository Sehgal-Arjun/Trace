import { RunTabs, type Tab } from "@/components/run-tabs";
import { RunView } from "@/components/run-view";
import { StatusPill } from "@/components/status-glyph";
import { shortSha, since } from "@/lib/format";
import type { Run } from "@/lib/runs/types";

export default function RunLayout({ children, params }: LayoutProps<"/runs/[id]">) {
  return (
    <>
      <RunView params={params} fallback={<div className="h-[52px] flex-none border-b border-line" />}>
        {(run) => <RunHeader run={run} />}
      </RunView>
      <div className="flex-1 overflow-auto">{children}</div>
    </>
  );
}

function RunHeader({ run }: { run: Run }) {
  return (
    <>
      <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line px-6 text-[13px] whitespace-nowrap">
        <span className="text-muted">
          {run.repo.owner}/{run.repo.name}
        </span>
        <span className="text-[#3a3d45]">/</span>
        <span className="text-muted">Runs</span>
        <span className="text-[#3a3d45]">/</span>
        <span className="font-mono text-[12.5px] text-fg">{run.id}</span>
      </header>

      <div className="flex-none border-b border-line px-6 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs font-medium text-muted">{run.id}</span>
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.015em]">{run.report.title}</h1>
          <StatusPill status={run.status} />
          <span className="ml-auto text-xs text-muted">{metaLine(run)}</span>
        </div>
        <RunTabs runId={run.id} tabs={tabsFor(run)} />
      </div>
    </>
  );
}

function metaLine(run: Run) {
  const src = run.report.source;
  const from = src.kind === "linear" ? `Linear ${src.issueId}` : src.kind === "github" ? `GitHub #${src.issueNumber}` : "Filed in Trace";
  return [`Reported ${since(run.report.createdAt)}`, run.report.reporter, from].filter(Boolean).join(" · ");
}

function tabsFor(run: Run): Tab[] {
  return [
    { segment: null, label: "Report", available: true },
    { segment: "trace", label: "Trace", available: !!run.rootCause, hint: run.rootCause?.symbol.replace(/\(.*\)$/, "()"), hintTone: "accent" },
    {
      segment: "test",
      label: "Test",
      available: !!run.test,
      hint: run.test && `${run.test.runs.failed}/${run.test.runs.total} failed`,
      hintTone: "muted",
    },
    { segment: "history", label: "History", available: !!run.bisect, hint: run.bisect && shortSha(run.bisect.culprit.sha), hintTone: "accent" },
    { segment: "pr", label: "Pull request", available: !!run.pr, hint: run.pr && `#${run.pr.number}`, hintTone: "pass" },
  ];
}

import { BisectChart } from "@/components/bisect-chart";
import { Code } from "@/components/code";
import { Badge, Facts, Panel } from "@/components/panel";
import { Prose } from "@/components/prose";
import { RunView } from "@/components/run-view";
import { duration, initials, shortDate, shortSha } from "@/lib/format";
import { searchSteps } from "@/lib/runs/bisect";
import type { Bisect, Probe, Run } from "@/lib/runs/types";

// History tab: how Trace searched the commit history, and the commit it landed on.
export default function HistoryPage({ params }: PageProps<"/runs/[id]/history">) {
  return <RunView params={params}>{(run) => (run.bisect ? <History run={run} bisect={run.bisect} /> : <NotYet />)}</RunView>;
}

function History({ run, bisect }: { run: Run; bisect: Bisect }) {
  const steps = searchSteps(bisect);
  const ran = bisect.probes.filter((p) => p.outcome !== "skip").length;
  const culprit = bisect.culprit;
  const culpritIndex = bisect.probes.find((p) => p.commit.sha === culprit.sha)?.index ?? 0;
  const far = Math.max(bisect.commitsSearched, ...bisect.probes.map((p) => p.index));

  return (
    <div className="flex flex-wrap items-start gap-5 px-6 pt-5 pb-10">
      <div className="flex min-w-0 flex-[1_1_680px] flex-col gap-4">
        <Panel
          title="Commit history"
          aside={
            <>
              <span className="font-mono text-xs text-muted">
                {run.repo.owner}/{run.repo.name} · {run.repo.defaultBranch}
              </span>
              <span className="ml-auto inline-flex h-[26px] items-center gap-2 rounded-full border border-[rgb(255_95_74/0.45)] bg-[rgb(255_95_74/0.12)] pr-[11px] pl-[9px] text-[12.5px] font-medium text-accent-fg">
                <span className="size-2 rounded-full bg-accent shadow-[0_0_8px_#ff5f4a]" />
                Found in {steps.length} steps across {bisect.commitsSearched.toLocaleString("en-US")} commits
              </span>
            </>
          }
        >
          <BisectChart
            steps={steps}
            far={far}
            culpritIndex={culpritIndex}
            culpritLabel={`${shortSha(culprit.sha)} · ${culprit.subject}`}
          />
        </Panel>

        <Panel
          title="Search log"
          aside={
            <span className="text-xs text-muted">
              {ran} test runs · {duration(bisect.seconds)} · {(bisect.commitsSearched - bisect.probes.length).toLocaleString("en-US")} commits
              never needed testing
            </span>
          }
        >
          <SearchLog probes={bisect.probes} culpritSha={culprit.sha} />
        </Panel>
      </div>

      <CulpritCard bisect={bisect} />
    </div>
  );
}

function SearchLog({ probes, culpritSha }: { probes: Probe[]; culpritSha: string }) {
  const cols = "grid grid-cols-[52px_64px_minmax(0,1fr)_116px_104px_76px_52px] gap-2.5";
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        <div className={`${cols} border-b border-line px-4 py-2 font-mono text-[10.5px] font-medium tracking-[0.05em] text-[#6b707a] uppercase`}>
          <span>Step</span>
          <span>Commit</span>
          <span>Message</span>
          <span>Author</span>
          <span>Date</span>
          <span>Result</span>
          <span className="text-right">Time</span>
        </div>
        {probes.map((p, i) => {
          const isCulprit = p.commit.sha === culpritSha;
          const result = isCulprit ? "culprit" : p.outcome;
          const badge = isCulprit
            ? "bg-accent text-bg"
            : p.outcome === "pass"
              ? "bg-[rgb(63_178_127/0.12)] text-pass"
              : p.outcome === "fail"
                ? "bg-[rgb(255_95_74/0.12)] text-accent-fg"
                : "bg-line-2 text-fg-3";
          return (
            <div
              key={`${p.commit.sha}-${i}`}
              title={p.reason}
              className={`${cols} items-center border-b border-[#15161a] px-4 py-1.5 text-[12.5px] ${isCulprit ? "bg-[rgb(255_95_74/0.06)]" : ""}`}
            >
              <span className="font-mono text-[11.5px] text-muted">{p.index === 0 ? "start" : String(i).padStart(2, "0")}</span>
              <span className={`font-mono text-xs font-medium ${isCulprit ? "text-accent-fg" : "text-fg-2"}`}>{shortSha(p.commit.sha)}</span>
              <span className={`truncate ${isCulprit ? "text-fg-strong" : "text-fg-2"}`}>{p.commit.subject}</span>
              <span className="truncate text-fg-3">{p.commit.author}</span>
              <span className="font-mono text-[11.5px] text-muted">{shortDate(p.commit.date)}</span>
              <span className={`justify-self-start rounded px-[7px] py-px font-mono text-[11px] font-medium ${badge}`}>{result}</span>
              <span className="text-right font-mono text-[11.5px] text-muted">{p.seconds.toFixed(1)} s</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CulpritCard({ bisect }: { bisect: Bisect }) {
  const c = bisect.culprit;
  const plus = bisect.diff?.reduce((a, f) => a + f.additions, 0) ?? 0;
  const minus = bisect.diff?.reduce((a, f) => a + f.deletions, 0) ?? 0;
  return (
    <Panel tone="accent" className="min-w-0 max-w-[460px] flex-[1_1_360px]">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Culprit</Badge>
          <span className="text-xs text-muted">First commit where the test fails</span>
        </div>
        <div className="font-mono text-[17px] leading-snug font-semibold tracking-[-0.01em]">{c.subject}</div>
        <div className="font-mono text-xs break-all text-muted">
          <span className="font-semibold text-accent-fg">{shortSha(c.sha)}</span>
          {c.sha.slice(7)}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 flex-none items-center justify-center rounded-full bg-line-4 text-[11px] font-semibold">
            {initials(c.author)}
          </span>
          <div>
            <div className="text-[13px] font-medium">{c.author}</div>
            {c.email && <div className="font-mono text-[11.5px] text-muted">{c.email}</div>}
          </div>
        </div>
        <Facts
          rows={[
            ["Committed", shortDate(c.date)],
            ...(c.pr ? ([["Merged in", `#${c.pr.number} ${c.pr.title}`]] as [string, string][]) : []),
            ...(bisect.diff
              ? ([["Changed", `${bisect.diff.length} files · +${plus} −${minus}`]] as [string, string][])
              : []),
          ]}
        />
        <div className="flex items-center gap-2.5 rounded-lg border border-line-2 bg-inset px-3 py-2.5 font-mono text-xs">
          <span className="flex items-center gap-1.5 text-fg-2">
            <span className="size-2 rounded-full bg-pass" />
            {shortSha(bisect.lastGood.sha)}
          </span>
          <span className="font-sans text-[11.5px] text-muted">passes</span>
          <span className="text-faint">→</span>
          <span className="flex items-center gap-1.5 text-accent-fg">
            <span className="size-2 rounded-full bg-accent" />
            {shortSha(c.sha)}
          </span>
          <span className="font-sans text-[11.5px] text-muted">fails</span>
        </div>
      </div>

      {bisect.diff?.map((f) => (
        <div key={f.file} className="border-t border-line-2">
          <div className="flex items-center gap-2 bg-[#121317] px-4 py-[9px] font-mono text-xs">
            <span className="text-fg">{f.file}</span>
            <span className="ml-auto text-pass">+{f.additions}</span>
            <span className="text-fg-3">−{f.deletions}</span>
          </div>
          <Code code={f.patch} diff />
        </div>
      ))}

      {bisect.whyMissed && (
        <p className="m-0 border-t border-line-2 px-4 py-3 text-[12.5px] text-fg-2">
          <span className="text-muted">Why CI missed it: </span>
          <Prose text={bisect.whyMissed} />
        </p>
      )}

      {c.pr && (
        <div className="flex border-t border-line-2 px-4 py-3">
          <a
            href={c.pr.url}
            target="_blank"
            rel="noreferrer"
            className="h-[30px] rounded-[7px] border border-line-4 bg-raised px-3 text-[12.5px] leading-[28px] font-medium text-[#d5d7dc] hover:bg-hover"
          >
            View on GitHub ↗
          </a>
        </div>
      )}
    </Panel>
  );
}

function NotYet() {
  return <p className="p-7 text-xs text-muted">Trace hasn&apos;t searched the history for this run yet.</p>;
}

import Link from "next/link";
import { Code } from "@/components/code";
import { Badge, Panel } from "@/components/panel";
import { Prose } from "@/components/prose";
import { RunView } from "@/components/run-view";
import type { RootCause, Run, TraceHop } from "@trace/core";

const LAYER: Record<TraceHop["layer"], string> = { ui: "UI", client: "Client", network: "Network", server: "Server", data: "Data" };

// Trace tab: each hop from what the user saw back to the first place things go wrong.
export default function TracePage({ params }: PageProps<"/runs/[id]/trace">) {
  return (
    <RunView params={params}>
      {(run) => (run.rootCause ? <Trace run={run} cause={run.rootCause} /> : <p className="p-7 text-xs text-muted">Not traced yet.</p>)}
    </RunView>
  );
}

function Trace({ run, cause }: { run: Run; cause: RootCause }) {
  return (
    <div className="mx-auto flex max-w-[1160px] flex-wrap items-start gap-5 px-6 pt-5 pb-10">
      <Panel title="Trace path" aside={<span className="ml-auto font-mono text-[11.5px] text-muted">{cause.path.length + 1} hops</span>} className="min-w-0 flex-[1_1_560px]">
        <ol className="m-0 flex list-none flex-col px-4 py-2">
          {cause.path.map((hop, i) => (
            <Hop key={i} hop={hop} first={i === 0} />
          ))}
          <RootCauseHop cause={cause} />
          {cause.downstream && cause.downstream.length > 0 && (
            <>
              <li className="mt-1 mb-0.5 ml-[26px] font-mono text-[10.5px] font-medium tracking-[0.05em] text-[#6b707a] uppercase">
                Downstream effect
              </li>
              {cause.downstream.map((d, i) => (
                <li key={i} className="flex gap-3">
                  <Rail dashed last={i === cause.downstream!.length - 1} dot="hollow" />
                  <div className="min-w-0 flex-1 pt-1 pb-2">
                    <div className="font-mono text-[12.5px] text-fg-3">{d.title}</div>
                    <div className="mt-px text-[11.5px] text-muted">{d.note}</div>
                  </div>
                </li>
              ))}
            </>
          )}
        </ol>
      </Panel>

      <div className="flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-4">
        <Panel title="In short">
          <p className="m-0 px-4 py-3.5 text-[13px] leading-relaxed text-fg-2">
            <Prose text={cause.summary} />
          </p>
        </Panel>
        {run.test && (
          <Link
            href={`/runs/${run.id}/test`}
            className="flex h-9 items-center justify-center rounded-lg bg-fg text-[13px] font-semibold text-bg hover:bg-white"
          >
            View the failing test →
          </Link>
        )}
      </div>
    </div>
  );
}

function Hop({ hop, first }: { hop: TraceHop; first: boolean }) {
  return (
    <li className="flex gap-3">
      <Rail first={first} />
      <details className="group my-1.5 min-w-0 flex-1 rounded-lg border border-line-2 px-3 py-[9px] open:border-line-4 open:bg-[#131418] hover:border-[#33363e]">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] font-medium tracking-[0.05em] text-[#8a8f98] uppercase">{LAYER[hop.layer]}</span>
            {hop.value && (
              <span className="ml-auto rounded-[5px] bg-[#17181c] px-[7px] py-px font-mono text-[11.5px] font-medium whitespace-nowrap text-fg-2">
                {hop.value}
              </span>
            )}
          </div>
          <div className="mt-[5px] font-mono text-[13px] font-medium break-words text-fg">{hop.title}</div>
          <div className="mt-0.5 font-mono text-[11.5px] text-muted">{hop.location}</div>
        </summary>
        {hop.details && (
          <dl className="m-0 mt-[9px] flex flex-col gap-1 border-t border-line-2 pt-[9px] font-mono text-[11.5px] leading-normal">
            {hop.details.map((d) => (
              <div key={d.key} className="flex gap-2.5">
                <dt className="min-w-[84px] flex-none text-muted">{d.key}</dt>
                <dd className={`m-0 break-words ${d.wrong ? "text-accent-fg" : "text-fg-2"}`}>{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </details>
    </li>
  );
}

function RootCauseHop({ cause }: { cause: RootCause }) {
  return (
    <li className="flex gap-3">
      <div className="flex w-3.5 flex-none flex-col items-center">
        <div className="h-[18px] w-[1.5px] bg-accent" />
        <div className="size-3.5 flex-none rounded-full bg-accent shadow-[0_0_0_4px_rgb(255_95_74/0.2),0_0_16px_rgb(255_95_74/0.6)]" />
        <div className="w-0 flex-1 border-l-[1.5px] border-dashed border-line-4" />
      </div>
      <div className="my-1.5 min-w-0 flex-1 overflow-hidden rounded-[10px] border border-[rgb(255_95_74/0.5)] bg-[rgb(255_95_74/0.05)]">
        <div className="px-3 pt-[11px] pb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Root cause</Badge>
            <span className="font-mono text-[11.5px] text-accent-fg">first wrong value</span>
          </div>
          <div className="mt-2 font-mono text-sm font-semibold">{cause.symbol}</div>
          <div className="mt-0.5 font-mono text-[11.5px] text-fg-3">
            {cause.file}:{cause.line}
          </div>
        </div>
        {cause.snippet && (
          <div className="border-t border-[rgb(255_95_74/0.22)]">
            <Code
              code={cause.snippet.code}
              startLine={cause.snippet.startLine}
              highlight={cause.snippet.highlightLine ? [cause.snippet.highlightLine] : []}
              notes={cause.snippet.highlightLine && cause.snippet.note ? { [cause.snippet.highlightLine]: cause.snippet.note } : {}}
            />
          </div>
        )}
      </div>
    </li>
  );
}

/** The vertical line and dot on the left of each hop. */
function Rail({ first = false, last = false, dashed = false, dot = "ring" }: { first?: boolean; last?: boolean; dashed?: boolean; dot?: "ring" | "hollow" }) {
  const line = dashed ? "w-0 border-l-[1.5px] border-dashed border-line-4" : "w-[1.5px] bg-line-4";
  return (
    <div className="flex w-3.5 flex-none flex-col items-center">
      <div className={`${dashed ? "h-2.5" : "h-[18px]"} ${first ? "" : line}`} />
      <div className={`flex-none rounded-full ${dot === "ring" ? "size-2.5 border-2 border-[#6b707a] bg-panel" : "size-2 border-[1.5px] border-faint"}`} />
      <div className={`flex-1 ${last ? "" : line}`} />
    </div>
  );
}

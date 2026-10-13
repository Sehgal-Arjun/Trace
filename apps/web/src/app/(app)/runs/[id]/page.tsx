import Link from "next/link";
import { Facts, Panel } from "@/components/panel";
import { RunView } from "@/components/run-view";
import { duration, shortDate, shortSha } from "@/lib/format";
import { STATUS } from "@/lib/runs/status";
import type { Attachment, Run } from "@trace/core";

// Report tab: what the reporter sent, and a summary of what Trace found.
export default function ReportPage({ params }: PageProps<"/runs/[id]">) {
  return <RunView params={params}>{(run) => <Report run={run} />}</RunView>;
}

function Report({ run }: { run: Run }) {
  const { report } = run;

  return (
    <div className="mx-auto flex max-w-[1160px] flex-wrap items-start gap-7 px-7 pt-7 pb-14">
      <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-5">
        <Panel title="What happened" aside={report.reporter && <span className="text-xs text-muted">from {report.reporter}</span>}>
          <p className="m-0 px-4 py-3.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[#d5d7dc]">{report.body}</p>
        </Panel>

        {report.attachments.length > 0 && (
          <Panel title="Attachments">
            <ul className="m-0 flex list-none flex-col p-0">
              {report.attachments.map((a) => (
                <AttachmentRow key={a.name} a={a} />
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <div className="flex max-w-[380px] flex-[1_1_300px] flex-col gap-3.5">
        <Panel title="Repository">
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <div className="font-mono text-[13.5px] font-semibold">
              {run.repo.owner}/{run.repo.name}
            </div>
            <Facts
              rows={[
                ["Branch", run.repo.defaultBranch],
                ...(run.repo.language ? ([["Language", run.repo.language]] as [string, string][]) : []),
                ...(run.repo.testRunner ? ([["Tests", run.repo.testRunner]] as [string, string][]) : []),
              ]}
            />
          </div>
        </Panel>

        <Findings run={run} />
      </div>
    </div>
  );
}

const KIND_LABEL: Record<Attachment["kind"], string> = { image: "IMG", video: "REC", har: "HAR", log: "LOG", link: "URL" };

function AttachmentRow({ a }: { a: Attachment }) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className="flex size-7 flex-none items-center justify-center rounded-md border border-[#26282e] bg-[#17181c] font-mono text-[8.5px] font-semibold text-fg-3">
        {KIND_LABEL[a.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px] font-medium">{a.name}</span>
        {a.meta && <span className="text-[11.5px] text-muted">{a.meta}</span>}
      </span>
    </li>
  );
}

/** What Trace has established so far, one line per stage, linking to the tab with the detail. */
function Findings({ run }: { run: Run }) {
  const rows: { label: string; value: string; href?: string }[] = [];
  if (run.rootCause) rows.push({ label: "Root cause", value: `${run.rootCause.file}:${run.rootCause.line}`, href: "trace" });
  if (run.test) rows.push({ label: "Test", value: `fails ${run.test.runs.failed} of ${run.test.runs.total} runs`, href: "test" });
  if (run.bisect)
    rows.push({
      label: "Culprit",
      value: `${shortSha(run.bisect.culprit.sha)} · ${run.bisect.culprit.author} · ${shortDate(run.bisect.culprit.date)}`,
      href: "history",
    });
  if (run.pr) rows.push({ label: "Pull request", value: `#${run.pr.number} ${run.pr.state}`, href: "pr" });

  const status = STATUS[run.status];
  return (
    <Panel title="Trace found" aside={<span className="ml-auto text-xs" style={{ color: status.text }}>{status.label}</span>}>
      <div className="flex flex-col gap-2.5 px-4 py-3.5 text-[12.5px]">
        {rows.length === 0 && <p className="m-0 text-muted">{status.active ? "Working on it…" : run.error ?? "Nothing yet."}</p>}
        {rows.map((r) => (
          <Link key={r.label} href={`/runs/${run.id}/${r.href}`} className="flex gap-3 hover:text-fg-strong">
            <span className="w-[84px] flex-none text-muted">{r.label}</span>
            <span className="min-w-0 truncate font-mono text-xs text-fg-2">{r.value}</span>
          </Link>
        ))}
        {run.startedAt && run.finishedAt && (
          <p className="m-0 border-t border-line-2 pt-2.5 text-xs text-muted">
            Took {duration((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)}
          </p>
        )}
      </div>
    </Panel>
  );
}

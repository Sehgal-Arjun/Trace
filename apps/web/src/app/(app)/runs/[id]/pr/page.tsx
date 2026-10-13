import { Code, langOf } from "@/components/code";
import { CopyButton } from "@/components/copy-button";
import { Panel } from "@/components/panel";
import { Prose } from "@/components/prose";
import { RunView } from "@/components/run-view";
import { initials, shortSha, since } from "@/lib/format";
import type { PullRequest, Run } from "@/lib/runs/types";

// Pull request tab: what Trace opened on GitHub, as reviewers will see it.
export default function PullRequestPage({ params }: PageProps<"/runs/[id]/pr">) {
  return (
    <RunView params={params}>
      {(run) => (run.pr ? <PR run={run} pr={run.pr} /> : <p className="p-7 text-xs text-muted">No pull request yet.</p>)}
    </RunView>
  );
}

function PR({ run, pr }: { run: Run; pr: PullRequest }) {
  const files = [
    ...(run.test ? [{ file: run.test.file, code: run.test.code }] : []),
    ...(run.test?.fixtures ?? []).map((f) => ({ file: f.file, code: f.code })),
  ];
  const added = (code: string) =>
    code
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");

  return (
    <div className="mx-auto flex max-w-[1220px] flex-col gap-4 px-6 pt-5 pb-12">
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line-2 bg-panel px-4 py-3">
        <div>
          <div className="text-[13px] font-medium">
            Trace opened a pull request on {run.repo.owner}/{run.repo.name}
          </div>
          <div className="text-xs text-muted">Opened {since(pr.openedAt)} · adds a failing test, no code changes</div>
        </div>
        <div className="ml-auto flex gap-2">
          <CopyButton text={pr.url} label="Copy link" />
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="h-[26px] rounded-md bg-fg px-3 text-xs leading-[26px] font-semibold text-bg hover:bg-white"
          >
            Open on GitHub ↗
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_640px] flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">
              {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
              <span className="rounded-full bg-pass px-2.5 py-0.5 font-semibold text-bg capitalize">{pr.state}</span>
              <span className="font-medium text-fg">trace-bot</span> wants to merge into
              <Ref>{run.repo.defaultBranch}</Ref> from <Ref>{pr.branch}</Ref>
            </div>
          </div>

          <Panel>
            <div className="flex flex-col gap-3.5 p-4 text-[13.5px] leading-relaxed text-[#d5d7dc]">
              <p className="m-0">
                Trace followed <strong className="text-fg-strong">{run.id}: {run.report.title}</strong> to its root cause and added a
                test that reproduces it. This PR only adds the test, so CI stays red until a fix lands.
              </p>
              <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] overflow-hidden rounded-lg border border-line-2 text-[12.5px]">
                {run.rootCause && (
                  <Row k="Root cause">
                    <span className="font-mono text-accent-fg">{run.rootCause.symbol}</span>
                    <span className="font-mono text-fg-3"> · {run.rootCause.file}:{run.rootCause.line}</span>
                  </Row>
                )}
                {run.bisect && (
                  <Row k="Introduced in">
                    <span className="font-mono text-accent-fg">{shortSha(run.bisect.culprit.sha)}</span> {run.bisect.culprit.subject} ·{" "}
                    {run.bisect.culprit.author}
                  </Row>
                )}
                {run.test && (
                  <Row k="Test">
                    failed {run.test.runs.failed} of {run.test.runs.total} runs
                  </Row>
                )}
              </dl>
              {run.rootCause && (
                <>
                  <div className="-mb-2 text-[13px] font-semibold text-fg-strong">What&apos;s happening</div>
                  <p className="m-0">
                    <Prose text={run.rootCause.summary} />
                  </p>
                </>
              )}
              {run.test && (
                <>
                  <div className="-mb-2 text-[13px] font-semibold text-fg-strong">Run it</div>
                  <code className="block overflow-x-auto rounded-[7px] border border-line-2 bg-inset px-3 py-2.5 font-mono text-[12.5px] whitespace-nowrap text-fg-2">
                    {run.test.command}
                  </code>
                </>
              )}
            </div>
          </Panel>

          {files.map((f) => (
            <Panel key={f.file}>
              <div className="flex items-center gap-2.5 border-b border-line-2 bg-[#121317] px-4 py-2.5 font-mono text-xs">
                <span className="text-fg">{f.file}</span>
                <span className="ml-auto text-pass">+{f.code.split("\n").length}</span>
              </div>
              <Code code={added(f.code)} lang={langOf(f.file)} diff />
            </Panel>
          ))}
        </div>

        <aside className="flex min-w-[240px] flex-[0_1_300px] flex-col text-[12.5px]">
          <Section title="Reviewers">
            {pr.reviewers.map((r) => (
              <div key={r.name} className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-line-4 text-[9px] font-semibold">{initials(r.name)}</span>
                {r.name}
                <span className="ml-auto text-[11.5px] text-muted">{r.reason}</span>
              </div>
            ))}
          </Section>
          <Section title="Labels">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full border border-[rgb(255_95_74/0.45)] px-2 py-px text-[11.5px] text-accent-fg">bug</span>
              <span className="rounded-full border border-line-4 px-2 py-px text-[11.5px] text-fg-2">has-repro</span>
            </div>
          </Section>
          {run.report.source.kind !== "manual" && (
            <Section title="Linked">
              <a href={run.report.source.url} target="_blank" rel="noreferrer" className="flex gap-2 text-fg-2 hover:text-fg">
                <span className="font-mono text-muted">
                  {run.report.source.kind === "linear" ? run.report.source.issueId : `#${run.report.source.issueNumber}`}
                </span>
                {run.report.source.kind === "linear" ? "Linear issue" : "GitHub issue"}
              </a>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Ref({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-[#17181c] px-1.5 py-px font-mono text-xs text-fg-2">{children}</span>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="border-b border-line-2 bg-[#121317] px-3 py-2 text-muted [&:nth-last-child(2)]:border-b-0">{k}</dt>
      <dd className="m-0 border-b border-line-2 px-3 py-2 last:border-b-0">{children}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3.5 first:pt-0 last:border-b-0">
      <span className="text-xs font-semibold text-fg-3">{title}</span>
      {children}
    </div>
  );
}

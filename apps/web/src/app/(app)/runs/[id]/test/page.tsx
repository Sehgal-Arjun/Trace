import { Code, langOf } from "@/components/code";
import { CopyButton } from "@/components/copy-button";
import { Badge, Panel } from "@/components/panel";
import { RunView } from "@/components/run-view";
import type { ReproTest } from "@trace/core";

// Test tab: the reproduction test Trace wrote, its fixtures, and proof it fails reliably.
export default function TestPage({ params }: PageProps<"/runs/[id]/test">) {
  return (
    <RunView params={params}>
      {(run) => (run.test ? <Test test={run.test} /> : <p className="p-7 text-xs text-muted">No test yet.</p>)}
    </RunView>
  );
}

function Test({ test }: { test: ReproTest }) {
  const lines = test.code.split("\n").length;
  const reliable = test.runs.failed === test.runs.total;
  return (
    <div className="flex flex-wrap items-start gap-5 px-6 pt-5 pb-10">
      <div className="flex min-w-0 flex-[1_1_620px] flex-col gap-4">
        <Panel>
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line-2 px-4 py-2.5">
            <span className="font-mono text-[12.5px] font-medium text-fg">{test.file}</span>
            <Tag>{test.runner}</Tag>
            <Tag>{lines} lines</Tag>
            <span className="ml-auto">
              <CopyButton text={test.code} />
            </span>
          </div>
          <Code code={test.code} lang={langOf(test.file)} size="md" />
        </Panel>

        {test.fixtures?.map((f) => (
          <Panel key={f.file} title="Fixture" aside={<span className="font-mono text-[12.5px] font-medium text-fg">{f.file}</span>}>
            <Code code={f.code} lang={langOf(f.file)} />
            {f.note && <p className="m-0 border-t border-line-2 px-4 py-2.5 text-xs text-muted">{f.note}</p>}
          </Panel>
        ))}
      </div>

      <div className="flex min-w-0 max-w-[440px] flex-[1_1_340px] flex-col gap-4">
        <Panel tone="accent">
          <div className="flex flex-col gap-3.5 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="accent">Reproduced</Badge>
              <span className="text-xs text-muted">{reliable ? "Not flaky" : "Flaky"}</span>
            </div>
            <div className="text-xl font-semibold tracking-[-0.015em]">
              Ran {test.runs.total} times: failed {test.runs.failed} of {test.runs.total}
            </div>
            <div className="grid grid-cols-10 gap-[5px]">
              {Array.from({ length: test.runs.total }, (_, i) => {
                const failed = i < test.runs.failed;
                return (
                  <div
                    key={i}
                    title={`Run ${i + 1}: ${failed ? "failed" : "passed"}`}
                    className={`aspect-square rounded border ${failed ? "border-accent bg-accent" : "border-pass bg-pass"}`}
                  />
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel title="Output">
          <pre className="m-0 overflow-x-auto bg-inset px-4 py-3 font-mono text-xs leading-[1.65] text-fg-3">{test.output}</pre>
        </Panel>

        <Panel title="Run it yourself">
          <div className="flex items-center gap-2 px-4 py-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap text-fg-2">{test.command}</code>
            <CopyButton text={test.command} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-line-4 px-[7px] py-px text-[11px] text-fg-3">{children}</span>;
}

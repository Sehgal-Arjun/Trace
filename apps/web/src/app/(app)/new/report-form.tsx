"use client";

import { useActionState } from "react";
import { fileReport, type ReportFormState } from "./actions";

const field =
  "rounded-[7px] border border-line-3 bg-field px-3 text-sm outline-none placeholder:text-faint focus:border-faint";

export function ReportForm() {
  const [state, action, pending] = useActionState<ReportFormState, FormData>(fileReport, {});

  return (
    <form action={action} className="mx-auto flex max-w-[1160px] flex-wrap items-start gap-7 px-7 pt-7 pb-14">
      <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-fg-3">Title</span>
          <input
            name="title"
            defaultValue={state.values?.title}
            required
            placeholder="Clicking Save empties the cart"
            className={`${field} h-[38px]`}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-fg-3">What happened</span>
          <textarea
            name="body"
            defaultValue={state.values?.body}
            required
            rows={6}
            placeholder="What you were doing, what you expected, and what happened instead."
            className={`${field} resize-y py-2.5 text-[13px] leading-normal`}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-fg-3">Repository</span>
          <input
            name="repo"
            defaultValue={state.values?.repo}
            required
            placeholder="owner/name"
            className={`${field} h-[38px] font-mono text-[13px]`}
          />
        </label>
        {state.error && <p className="m-0 text-xs text-accent-fg">{state.error}</p>}
      </div>

      <div className="sticky top-0 flex max-w-[380px] flex-[1_1_300px] flex-col gap-3.5">
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line-2 bg-panel px-4 py-3.5">
          <span className="eyebrow">Trace will</span>
          <ol className="m-0 grid list-none grid-cols-[18px_1fr] gap-x-2.5 gap-y-2 p-0 text-[12.5px] text-fg-2">
            {[
              "Follow the failure to the function where it starts",
              "Write a small test that fails because of the bug",
              "Search history for the commit that broke it",
              "Open a pull request with the test",
            ].map((step, i) => (
              <li key={step} className="contents">
                <span className="font-mono text-[11px] font-medium text-muted">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="h-[42px] rounded-lg bg-fg text-sm font-semibold text-bg hover:bg-white disabled:opacity-50"
        >
          {pending ? "Filing…" : "Trace bug"}
        </button>
      </div>
    </form>
  );
}

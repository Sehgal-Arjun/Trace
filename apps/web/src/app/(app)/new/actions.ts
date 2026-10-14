"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRun } from "@/lib/runs/store";

export type ReportFormState = {
  error?: string;
  /** What was submitted, so a rejected form comes back filled in. */
  values?: { title: string; body: string; repo: string };
};

// Trace runs locally for now and has no accounts, so there's no auth check here yet.
// Add one before this is reachable by anyone but the person running it.
export async function fileReport(_prev: ReportFormState, form: FormData): Promise<ReportFormState> {
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const repo = String(form.get("repo") ?? "").trim();

  const values = { title, body, repo };
  const match = repo.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!title) return { error: "Give the report a title.", values };
  if (!body) return { error: "Describe what happened.", values };
  if (!match) return { error: "Repository should look like owner/name.", values };

  const run = await createRun({
    repo: { owner: match[1], name: match[2], defaultBranch: "main" },
    report: { title, body, source: { kind: "manual" }, attachments: [] },
  });
  revalidatePath("/", "layout"); // the sidebar's run list lives in the root layout
  redirect(`/runs/${run.id}`);
}

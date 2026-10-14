import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getRun } from "@/lib/runs/store";
import type { Run } from "@/lib/runs/types";

/**
 * Loads the run named in the route and renders it. Run data is read per
 * request, so it streams in behind a Suspense boundary while the page shell
 * renders immediately.
 */
export function RunView({
  params,
  fallback = <Placeholder />,
  children,
}: {
  params: Promise<{ id: string }>;
  fallback?: ReactNode;
  children: (run: Run) => ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <Resolve params={params} render={children} />
    </Suspense>
  );
}

async function Resolve({ params, render }: { params: Promise<{ id: string }>; render: (run: Run) => ReactNode }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  return render(run);
}

function Placeholder() {
  return <div className="p-7 text-xs text-muted">Loading…</div>;
}

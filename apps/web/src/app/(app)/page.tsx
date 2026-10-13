import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listRuns } from "@/lib/runs/store";

export default function Home() {
  return (
    <Suspense>
      <LatestRun />
    </Suspense>
  );
}

// The home page is the most recent run; with no runs, point people at a first report.
async function LatestRun() {
  const [latest] = await listRuns();
  if (latest) redirect(`/runs/${latest.id}`);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-medium">No runs yet</p>
      <p className="max-w-sm text-xs text-muted">
        Connect Linear and Trace will pick up new bug tickets automatically, or file one by hand with New bug report.
      </p>
    </div>
  );
}

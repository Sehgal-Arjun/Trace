import { ReportForm } from "./report-form";

export default function NewReportPage() {
  return (
    <>
      <header className="flex h-[52px] flex-none items-center border-b border-line px-6 text-[13px]">
        <span className="text-muted">New bug report</span>
      </header>
      <div className="flex-1 overflow-auto">
        <ReportForm />
      </div>
    </>
  );
}

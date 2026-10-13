import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-screen min-h-[620px] overflow-hidden">
      <Suspense fallback={<aside className="w-[252px] flex-none border-r border-line bg-sidebar" />}>
        <Sidebar />
      </Suspense>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

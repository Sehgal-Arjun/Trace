import type { ReactNode } from "react";

/** The bordered card used across run pages, with an optional eyebrow header row. */
export function Panel({
  title,
  aside,
  tone = "default",
  className = "",
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  tone?: "default" | "accent";
  className?: string;
  children: ReactNode;
}) {
  const border = tone === "accent" ? "border-[rgb(255_95_74/0.45)]" : "border-line-2";
  return (
    <section className={`overflow-hidden rounded-[10px] border bg-panel ${border} ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center gap-2.5 border-b border-line-2 px-4 py-[11px]">
          <span className="eyebrow">{title}</span>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** Two-column key/value grid used for metadata. */
export function Facts({ rows, mono = false }: { rows: [string, ReactNode][]; mono?: boolean }) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-xs ${mono ? "font-mono" : ""}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 text-fg-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Badge({ tone, children }: { tone: "accent" | "pass"; children: ReactNode }) {
  const cls = tone === "accent" ? "bg-accent text-bg" : "bg-pass text-bg";
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.05em] uppercase ${cls}`}>
      {children}
    </span>
  );
}

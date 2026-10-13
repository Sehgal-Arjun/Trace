// Small, dependency-free code view with the design's syntax colors.
// Good enough for short snippets, tests and diffs; not a general highlighter.

const KEYWORDS = new Set([
  "import", "from", "export", "function", "const", "let", "var", "return", "if", "else", "interface", "type",
  "new", "true", "false", "null", "undefined", "describe", "it", "test", "expect", "async", "await", "class",
]);

type Token = { v: string; c: string };

const TOKEN_RE = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d'"`]+)/g;

function tokenize(line: string, lang: "ts" | "json"): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const v = m[0];
    const end = (m.index ?? 0) + v.length;
    let c = "#c9ccd3";
    if (m[1]) c = "#5c616b";
    else if (m[2]) c = lang === "json" && /^\s*:/.test(line.slice(end)) ? "#c9ccd3" : "#a8d8b9";
    else if (m[3]) c = "#c3b1ff";
    else if (m[4]) {
      if (KEYWORDS.has(v)) c = "#8fa3e8";
      else if (line[end] === "(") c = "#f1f2f4";
      else if (/^[A-Z]/.test(v)) c = "#d9c9a3";
    } else if (m[6]) c = "#7d828c";
    out.push({ v, c });
  }
  return out;
}

export function langOf(file: string): "ts" | "json" {
  return file.endsWith(".json") ? "json" : "ts";
}

type CodeProps = {
  code: string;
  lang?: "ts" | "json";
  startLine?: number;
  /** Line numbers (in file numbering) to tint red. */
  highlight?: number[];
  /** Notes rendered under a line, e.g. "↳ discount.value is undefined". */
  notes?: Record<number, string>;
  /** Right-aligned annotations per line. */
  annotations?: Record<number, string>;
  /** Treat the code as a unified diff (+/-/@@ prefixes). */
  diff?: boolean;
  size?: "sm" | "md";
  numbers?: boolean;
};

export function Code({
  code,
  lang = "ts",
  startLine = 1,
  highlight = [],
  notes = {},
  annotations = {},
  diff = false,
  size = "sm",
  numbers = true,
}: CodeProps) {
  const rows: React.ReactNode[] = [];
  let n = startLine;
  const text = size === "md" ? "text-[13px] leading-[22px]" : "text-xs leading-5";

  code.split("\n").forEach((raw, i) => {
    let body = raw;
    let bg = "";
    let sign = "";
    let signColor = "#4a4e57";
    if (diff) {
      const c = raw[0];
      if (c === "@") {
        rows.push(
          <div key={`h${i}`} className="flex bg-[rgb(143_163_232/0.06)] pl-4 text-muted">
            <span className="whitespace-pre">{raw}</span>
          </div>,
        );
        return;
      }
      body = raw.slice(1);
      if (c === "+") [bg, sign, signColor] = ["bg-[rgb(63_178_127/0.09)]", "+", "#3fb27f"];
      else if (c === "-") [bg, sign, signColor] = ["bg-[rgb(255_255_255/0.035)]", "−", "#7d828c"];
    }
    if (highlight.includes(n)) bg = "bg-[rgb(255_95_74/0.12)]";

    rows.push(
      <div key={i} className={`flex ${bg}`}>
        {numbers && !diff && (
          <span className="w-11 flex-none pr-3 text-right text-faint select-none">{n}</span>
        )}
        {diff && (
          <span className="w-6 flex-none text-center" style={{ color: signColor }}>
            {sign}
          </span>
        )}
        <span className="pr-4 whitespace-pre">
          {tokenize(body, lang).map((t, k) => (
            <span key={k} style={{ color: t.c }}>
              {t.v}
            </span>
          ))}
        </span>
        {annotations[n] && (
          <span className="ml-auto pr-4 pl-6 text-[11px] whitespace-nowrap text-fg-3">{annotations[n]}</span>
        )}
      </div>,
    );
    if (notes[n]) {
      rows.push(
        <div key={`n${i}`} className="flex bg-[rgb(255_95_74/0.08)] text-accent-fg">
          {numbers && !diff && <span className="w-11 flex-none" />}
          <span className="pr-4 pl-6 whitespace-pre">↳ {notes[n]}</span>
        </div>,
      );
    }
    n++;
  });

  return (
    <div className={`overflow-x-auto bg-inset py-2 font-mono ${text}`}>
      <div className="min-w-max">{rows}</div>
    </div>
  );
}

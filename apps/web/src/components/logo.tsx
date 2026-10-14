/** The Trace mark: a path that ends in a red dot. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center rounded-md bg-fg"
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
    >
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 3.5h5v7h3.4" stroke="#0A0B0D" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11.6" cy="10.5" r="1.7" fill="#FF5F4A" />
      </svg>
    </span>
  );
}

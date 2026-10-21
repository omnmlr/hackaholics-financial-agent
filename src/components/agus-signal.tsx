/** A small woven signal, used consistently for AGUS and response activity. */
export function AgusSignal({ className = "" }: { className?: string }) {
  return (
    <span className={`agus-signal ${className}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none">
        <ellipse cx="40" cy="40" rx="15" ry="29" transform="rotate(35 40 40)" />
        <ellipse
          cx="40"
          cy="40"
          rx="15"
          ry="29"
          transform="rotate(-35 40 40)"
        />
        <path d="M18 40h44" />
        <circle cx="40" cy="40" r="4" />
      </svg>
    </span>
  );
}

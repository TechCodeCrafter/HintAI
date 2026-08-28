import { useId, type CSSProperties } from "react";

/**
 * The MeetHint mark: two cones facing each other across a signal — the room on
 * one side, the material on the other — which together read as an M.
 *
 * Drawn rather than imported so it stays crisp from favicon size up, sits on any
 * background, and takes its colour from the theme tokens. The corners are
 * softened with a same-paint stroke and round joins, which is cheaper and
 * sharper than arcing every vertex.
 */
export function MeetHintMark({
  className,
  style,
}: {
  className?: string;
  /** For contexts without Tailwind, such as the Remotion demo composition. */
  style?: CSSProperties;
}) {
  const gradient = useId();

  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="MeetHint" className={className} style={style}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0%" stopColor="var(--color-brand-blue)" />
          <stop offset="100%" stopColor="var(--color-brand-violet)" />
        </linearGradient>
      </defs>
      <g
        fill={`url(#${gradient})`}
        stroke={`url(#${gradient})`}
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M9 10 L25 16 L25 26 L27.5 26 L27.5 38 L25 38 L25 48 L9 54 Z" />
        <path d="M55 10 L39 16 L39 26 L36.5 26 L36.5 38 L39 38 L39 48 L55 54 Z" />
      </g>
      <g fill="var(--color-brand-signal)">
        <rect x="28.8" y="28.5" width="1.4" height="7" rx="0.7" />
        <rect x="31.3" y="26" width="1.4" height="12" rx="0.7" />
        <rect x="33.8" y="28.5" width="1.4" height="7" rx="0.7" />
      </g>
    </svg>
  );
}

/** The app mark (same drawing as app/icon.svg) and, optionally, the name. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="7.5" y="8" width="17" height="12.5" rx="3.5" fill="var(--accent-text)" />
      <path d="M10.5 19.5v5l5-5z" fill="var(--accent-text)" />
      <circle cx="12.5" cy="14.25" r="1.35" fill="var(--accent)" />
      <circle cx="16" cy="14.25" r="1.35" fill="var(--accent)" />
      <circle cx="19.5" cy="14.25" r="1.35" fill="var(--accent)" />
    </svg>
  );
}

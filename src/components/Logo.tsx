export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="sf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect x="3" y="7" width="20" height="16" rx="4" fill="#c7d2fe" transform="rotate(-8 13 15)" />
      <rect x="8" y="8" width="21" height="17" rx="4" fill="url(#sf-g)" />
      <path d="M17.5 11.5l-3.5 6h3l-1 4.5 4.5-6.5h-3l1-4z" fill="#fff" />
    </svg>
  );
}

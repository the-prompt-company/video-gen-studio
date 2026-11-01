const PATHS = {
  plus: "M10 4.5v11M4.5 10h11",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  down: "M10 3.5v9M6 9l4 4 4-4M4.5 16h11",
  redo: "M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3h-3",
  chevron: "M6 8l4 4 4-4",
  sliders: "M4 6h7M14 6h2M4 14h2M9 14h7M11 4v4M6 12v4",
  film: "M4 4.5h12v11H4zM7 4.5v11M13 4.5v11M4 8h3M13 8h3M4 12h3M13 12h3",
  image: "M4 4.5h12v11H4zM4 13l4-4 3 3 2-2 3 3M12.5 7.25a.75.75 0 1 0 0 1.5.75.75 0 1 0 0-1.5",
  arrow: "M6 10h8M11 7l3 3-3 3",
  check: "M5 10.5l3 3 7-7",
  latest: "M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5",
  grid: "M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z",
  chat: "M4 5.5h12v8H9.5L6 16.5v-3H4z",
  flag: "M5.5 16.5v-12M5.5 4.5h8.5l-2 3 2 3H5.5",
  clip: "M14.5 9.5l-5 5a2.75 2.75 0 0 1-3.9-3.9l5.6-5.6a1.75 1.75 0 0 1 2.5 2.5l-5.4 5.4a.75.75 0 0 1-1.1-1.1l4.9-4.9",
} as const;

export type IconName = keyof typeof PATHS;

/** Decorative (aria-hidden): the control around it must carry the name. */
export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

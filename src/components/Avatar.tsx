const SIZES = { sm: "size-7 text-xs", lg: "size-24 text-4xl" };

function initial(name: string): string {
  const first = new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(name)[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toUpperCase();
}

/** The member's photo, or the first letter of their name on a slate disc when there is none. */
export function Avatar({ name, url, size, alt = "" }: { name: string; url: string | null; size: keyof typeof SIZES; alt?: string }) {
  const box = `${SIZES[size]} shrink-0 rounded-full border border-border bg-surface-2`;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} className={`${box} object-cover`} />;
  }
  return (
    <span aria-hidden="true" className={`${box} flex select-none items-center justify-center font-medium leading-none text-foreground-2`}>
      {initial(name)}
    </span>
  );
}

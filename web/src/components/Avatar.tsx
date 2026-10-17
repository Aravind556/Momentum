import { cx } from "./ui";

/** Initials in a neutral circle — calm and consistent, no emoji. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-medium text-muted",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
        className,
      )}
    >
      {initials}
    </span>
  );
}

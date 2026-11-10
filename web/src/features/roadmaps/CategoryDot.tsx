import { CATEGORY_META, type Category } from "@momentum/shared";
import { cx } from "../../components/ui";

const DOT: Record<string, string> = {
  leetcode: "bg-[var(--platform-leetcode)]",
  codeforces: "bg-[var(--platform-codeforces)]",
  codechef: "bg-[var(--platform-codechef)]",
  other: "bg-faint",
};

/** Small platform identity dot. Always pair with visible text; `label` adds a screen-reader name. */
export function CategoryDot({ category, className }: { category: string; className?: string }) {
  return (
    <span
      className={cx("inline-block size-2 shrink-0 rounded-full", DOT[category] ?? DOT.other, className)}
      role="img"
      aria-label={CATEGORY_META[category as Category]?.label ?? category}
    />
  );
}

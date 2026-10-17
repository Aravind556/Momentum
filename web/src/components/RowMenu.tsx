import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx, IconButton } from "./ui";

export interface RowMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

/** A small "⋯" menu. Closes on outside click and Escape. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!items.length) return <span className="size-8" aria-hidden />;
  return (
    <div ref={ref} className="relative">
      <IconButton label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="size-4" />
      </IconButton>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-20 min-w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={cx("flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2", it.danger ? "text-danger" : "text-fg")}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <it.icon className="size-3.5" aria-hidden />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

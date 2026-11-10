import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  CalendarDays,
  CircleDot,
  Home,
  Map as MapIcon,
  LogOut,
  MoreHorizontal,
  Settings,
  Timer,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { relativeTime } from "../lib/format";
import { useAction, useMe } from "../lib/hooks";
import type { FocusSession, Notification } from "../lib/types";
import { Avatar } from "./Avatar";
import { PlanUpdates } from "./PlanUpdates";
import { cx, IconButton } from "./ui";

const NAV = [
  { to: "/", label: "Today", icon: Home, end: true },
  { to: "/planner", label: "Planner", icon: CalendarDays },
  { to: "/roadmaps", label: "Roadmaps", icon: MapIcon },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/progress", label: "Progress", icon: BarChart3 },
  { to: "/focus", label: "Focus", icon: Timer },
  { to: "/settings", label: "Settings", icon: Settings },
];
const MOBILE_PRIMARY = ["/", "/planner", "/roadmaps", "/groups"];

export function Layout() {
  const me = useMe();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const active = useQuery({
    queryKey: ["focus", "active"],
    queryFn: () => api.get<{ session: FocusSession | null }>("/focus-sessions/active"),
    refetchInterval: 60_000,
  });

  const signOut = async () => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface md:flex">
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <CircleDot className="size-5 text-accent" aria-hidden />
            <span className="text-[15px] font-semibold tracking-tight">Momentum</span>
          </div>
          <p className="mt-0.5 pl-7 text-xs text-muted">Make every day count.</p>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium",
                  isActive ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )
              }
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        {active.data?.session && <ActiveSessionPill session={active.data.session} onClick={() => navigate("/focus")} />}
        <div className="flex items-center gap-2 border-t border-line px-3 py-3">
          <Avatar name={me.data?.profile.displayName ?? ""} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{me.data?.profile.displayName}</p>
            <p className="truncate text-xs text-faint">@{me.data?.profile.username}</p>
          </div>
          <IconButton label="Sign out" onClick={signOut}>
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-bg/90 px-4 backdrop-blur md:justify-end">
          <span className="flex items-center gap-2 md:hidden">
            <CircleDot className="size-5 text-accent" aria-hidden />
            <span className="font-semibold">Momentum</span>
          </span>
          <div className="flex items-center gap-1">
            {active.data?.session && (
              <button onClick={() => navigate("/focus")} className="md:hidden">
                <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent">{active.data.session.isPaused ? "Paused" : "Focusing"}</span>
              </button>
            )}
            <NotificationsBell />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">
          <PlanUpdates />
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface md:hidden">
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => cx("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]", isActive ? "text-accent" : "text-muted")}
          >
            <n.icon className="size-5" aria-hidden />
            {n.label.split(" ")[0]}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted">
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </nav>
      {moreOpen && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-line bg-surface p-2 md:hidden">
          <div className="grid grid-cols-3 gap-1">
            {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setMoreOpen(false)} className="flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-xs text-muted hover:bg-surface-2">
                <n.icon className="size-5" aria-hidden />
                {n.label}
              </NavLink>
            ))}
            <button onClick={signOut} className="flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-xs text-muted hover:bg-surface-2">
              <LogOut className="size-5" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveSessionPill({ session, onClick }: { session: FocusSession; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-left">
      <Timer className="size-4 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-accent">{session.isPaused ? "Session paused" : "Focusing now"}</span>
        <span className="block truncate text-xs text-muted">{session.taskTitle ?? (session.kind === "break" ? "Break" : "Untitled session")}</span>
      </span>
    </button>
  );
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
  });
  const markAll = useAction(() => api.post("/notifications/read", {}), { invalidate: [["notifications"]] });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const unread = q.data?.unread ?? 0;
  return (
    <div ref={ref} className="relative">
      <IconButton label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" aria-hidden />}
      </IconButton>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            <button className="text-xs text-accent disabled:text-faint" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(q.data?.items ?? []).length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">You're all caught up.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className="flex w-full gap-2 px-3 py-2.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    setOpen(false);
                    const link = typeof n.payload.link === "string" ? n.payload.link : n.payload.groupId ? `/groups/${n.payload.groupId}` : null;
                    if (link) navigate(link);
                  }}
                >
                  <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px]">{n.payload.message ?? n.type}</span>
                    <span className="text-xs text-faint">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

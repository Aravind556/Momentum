import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Home,
  ListChecks,
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
import { cx, IconButton, useToast } from "./ui";

const NAV = [
  { to: "/", label: "Today", icon: Home, end: true },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/roadmaps", label: "Roadmaps", icon: MapIcon },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/progress", label: "Progress", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];
const MOBILE_PRIMARY = ["/", "/tasks", "/calendar", "/roadmaps"];

/**
 * New accounts start on UTC. If that's still the setting and this browser is somewhere else, adopt
 * the browser's timezone once, so "today", reminder hours and the plan follow the user's clock.
 */
function useAdoptBrowserTimezone() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const tried = useRef(false);
  const current = me.data?.profile.timezone;
  useEffect(() => {
    if (tried.current || current !== "UTC") return;
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browser || browser === "UTC" || browser === "Etc/UTC") return;
    tried.current = true;
    api
      .patch("/me", { timezone: browser })
      .then(() => {
        qc.invalidateQueries();
        toast(`Timezone set to ${browser}. You can change it in Settings.`, "info");
      })
      .catch(() => undefined);
  }, [current, qc, toast]);
}

export function Layout() {
  const me = useMe();
  useAdoptBrowserTimezone();
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
            <img src="/momentum-icons/favicon-32.svg" alt="" className="size-6" />
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
        <header className="sticky top-0 z-30 flex h-[calc(3rem+env(safe-area-inset-top))] items-center justify-between border-b border-line bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:justify-end">
          <span className="flex items-center gap-2 md:hidden">
            <img src="/momentum-icons/favicon-32.svg" alt="" className="size-6" />
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
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:px-8 md:pb-10">
          <PlanUpdates />
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
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
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 rounded-t-2xl border-t border-line bg-surface p-2 shadow-2xl md:hidden">
          <nav aria-label="More pages" className="flex flex-col">
            {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cx("flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium", isActive ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")
                }
              >
                <n.icon className="size-5" aria-hidden />
                {n.label}
              </NavLink>
            ))}
            <div className="my-1 border-t border-line" aria-hidden />
            <button onClick={signOut} className="flex h-12 items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
              <LogOut className="size-5" aria-hidden />
              Sign out
            </button>
          </nav>
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

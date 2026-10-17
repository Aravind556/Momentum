import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { SCHEDULE_KEYS, useAction } from "../../lib/hooks";
import type { Platform } from "../../lib/types";
import { Badge, Button, Card, ErrorState, Input, Spinner } from "../../components/ui";

/** One row per coding platform: connect a public handle, sync, disconnect. */
export function PlatformConnections() {
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<Platform[]>("/integrations") });
  return (
    <Card title="Coding platforms">
      <p className="mb-4 text-sm text-muted">Connect your public handle. Problems are only marked done after a matching accepted submission is found — no password needed.</p>
      {q.isPending ? <Spinner /> : q.isError ? <ErrorState error={q.error} /> : (
        <ul className="divide-y divide-line">
          {q.data.map((p) => (
            <PlatformRow key={p.provider} p={p} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlatformRow({ p }: { p: Platform }) {
  const [handle, setHandle] = useState("");
  const inv = [["integrations"], ["me"], ...SCHEDULE_KEYS];
  const connect = useAction(() => api.put(`/integrations/${p.provider}`, { handle: handle.trim() }), { invalidate: inv, success: `${p.label} connected` });
  const sync = useAction(
    () => api.post<{ ok: boolean; cooldown?: boolean; nextAllowedAt?: string; error?: string; verified?: number; newEvents?: number }>(`/integrations/${p.provider}/sync`),
    {
      invalidate: [...inv, ["progress"], ["submissions"]],
      success: (r) =>
        r.cooldown
          ? `Just synced — you can sync again in ${Math.max(1, Math.ceil((Date.parse(r.nextAllowedAt ?? "") - Date.now()) / 1000))}s`
          : r.ok
            ? `Synced · ${r.newEvents ?? 0} new submissions, ${r.verified ?? 0} verified`
            : `Sync failed: ${r.error}`,
    },
  );
  const disconnect = useAction(() => api.del(`/integrations/${p.provider}`), { invalidate: inv, success: `${p.label} disconnected` });
  const c = p.connection;
  const connected = c && c.status !== "disconnected";

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          {p.label}
          {connected && <Badge tone={c.status === "connected" ? "ok" : "danger"}>{c.status === "connected" ? `@${c.externalAccountId}` : "Needs attention"}</Badge>}
        </p>
        <p className="text-xs text-muted">
          {!p.available ? p.unavailableReason : connected ? `Last synced ${c.lastSyncAt ? relativeTime(c.lastSyncAt) : "never"}` : p.description}
        </p>
        {connected && c.lastError && <p className="text-xs text-danger">{c.lastError}</p>}
      </div>
      {connected ? (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} disabled={!p.available} onClick={() => sync.mutate()}>
            Sync now
          </Button>
          <Button size="sm" variant="ghost" loading={disconnect.isPending} onClick={() => confirm(`Disconnect ${p.label}?`) && disconnect.mutate()}>
            Disconnect
          </Button>
        </div>
      ) : p.available ? (
        <form
          className="flex shrink-0 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (handle.trim()) connect.mutate();
          }}
        >
          <Input aria-label={`${p.label} handle`} placeholder={`${p.label} handle`} className="w-44" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <Button type="submit" variant="primary" loading={connect.isPending} disabled={!handle.trim()}>
            Connect
          </Button>
        </form>
      ) : null}
    </li>
  );
}

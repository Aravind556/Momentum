import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { SCHEDULE_KEYS, useAction } from "../lib/hooks";
import { Badge, Button, Card, ErrorState, Input, Spinner, useToast } from "../components/ui";

interface Integration {
  provider: "leetcode" | "github";
  label: string;
  description: string;
  authType: "username" | "oauth";
  limitations: string[];
  available: boolean;
  unavailableReason: string | null;
  connection: { status: string; externalAccountId: string; lastSyncAt: string | null; lastError: string | null; nextSyncAfter: string | null } | null;
}

export function IntegrationsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<Integration[]>("/integrations") });
  useEffect(() => {
    if (params.get("connected")) toast("GitHub connected", "ok");
    if (params.get("error")) toast(params.get("error")!, "error");
    if (params.get("connected") || params.get("error")) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="text-sm text-muted">Connected services can verify tasks automatically. Without one, you can still complete tasks manually — they're labelled as not independently verified.</p>
      </header>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {q.data.map((i) => (
            <IntegrationCard key={i.provider} i={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationCard({ i }: { i: Integration }) {
  const [username, setUsername] = useState("");
  const inv = [["integrations"], ...SCHEDULE_KEYS];
  const connectLc = useAction(() => api.post("/integrations/leetcode/connect", { username }), { invalidate: inv, success: "LeetCode connected" });
  const connectGh = useAction(() => api.post<{ url: string }>("/integrations/github/connect"), { onSuccess: (r) => (window.location.href = r.url) });
  const sync = useAction(() => api.post<{ ok: boolean; error?: string; verified?: number; newEvents?: number }>(`/integrations/${i.provider}/sync`), {
    invalidate: inv,
    success: (r) => (r.ok ? `Synced: ${r.newEvents ?? 0} new events, ${r.verified ?? 0} task(s) verified` : `Sync failed: ${r.error}. Task statuses were not changed.`),
  });
  const disconnect = useAction(() => api.del(`/integrations/${i.provider}`), { invalidate: inv, success: "Disconnected and credentials deleted" });
  const c = i.connection;
  const connected = c && c.status !== "disconnected";
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {i.label}
          {connected ? <Badge tone={c.status === "connected" ? "ok" : "danger"}>{c.status === "connected" ? "Connected" : "Needs attention"}</Badge> : <Badge>Not connected</Badge>}
        </span>
      }
    >
      <p className="text-sm text-muted">{i.description}</p>
      {!i.available && <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-muted">{i.unavailableReason}</p>}
      {connected ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Account: <span className="font-medium">{c.externalAccountId}</span>
          </p>
          <p className="text-xs text-muted">Last successful sync: {c.lastSyncAt ? relativeTime(c.lastSyncAt) : "never"}</p>
          {c.lastError && <p className="text-xs text-danger">{c.lastError}{c.nextSyncAfter && ` · retrying after ${new Date(c.nextSyncAfter).toLocaleTimeString()}`}</p>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} disabled={!i.available} onClick={() => sync.mutate()}>
              Sync now
            </Button>
            {i.authType === "oauth" && c.status === "error" && (
              <Button size="sm" onClick={() => connectGh.mutate()} loading={connectGh.isPending}>
                Reconnect
              </Button>
            )}
            <Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => confirm(`Disconnect ${i.label}? Stored credentials are deleted.`) && disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : i.available ? (
        i.authType === "username" ? (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (username.trim()) connectLc.mutate();
            }}
          >
            <Input aria-label="LeetCode username" placeholder="LeetCode username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Button type="submit" variant="primary" loading={connectLc.isPending} disabled={!username.trim()}>
              Connect
            </Button>
          </form>
        ) : (
          <Button className="mt-4" variant="primary" loading={connectGh.isPending} onClick={() => connectGh.mutate()}>
            Connect with GitHub
          </Button>
        )
      ) : null}
      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer select-none">Limitations</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {i.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

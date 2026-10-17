import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import type { Group } from "../../lib/types";
import { Button, Card, Spinner } from "../../components/ui";

/** Owner-only: offer this roadmap to groups. Members decide for themselves whether to subscribe. */
export function ShareToGroups({ roadmapId }: { roadmapId: string }) {
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const shares = useQuery({ queryKey: ["roadmap-shares", roadmapId], queryFn: () => api.get<Array<{ groupId: string; name: string }>>(`/roadmaps/${roadmapId}/shares`) });
  const inv = [["roadmap-shares", roadmapId], ["group-roadmaps"]];
  const share = useAction((groupId: string) => api.post(`/roadmaps/${roadmapId}/shares/${groupId}`), { invalidate: inv, success: "Shared — members can subscribe" });
  const unshare = useAction((groupId: string) => api.del(`/roadmaps/${roadmapId}/shares/${groupId}`), { invalidate: inv, success: "No longer shared" });
  const sharedIds = new Set((shares.data ?? []).map((x) => x.groupId));
  return (
    <Card title="Shared with">
      {groups.isPending || shares.isPending ? (
        <Spinner />
      ) : !groups.data?.length ? (
        <p className="text-sm text-muted">
          Join or create a <Link to="/groups" className="text-accent">group</Link> to learn this roadmap together.
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.data.map((g) => {
            const on = sharedIds.has(g.id);
            return (
              <li key={g.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{g.name}</span>
                <Button size="sm" variant={on ? "ghost" : "secondary"} onClick={() => (on ? unshare.mutate(g.id) : share.mutate(g.id))}>
                  {on ? "Unshare" : "Share"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-faint">Sharing only offers it. Nobody's plan changes until they subscribe.</p>
    </Card>
  );
}

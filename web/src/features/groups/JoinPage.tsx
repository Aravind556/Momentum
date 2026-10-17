import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import { Button, Card, ErrorState, Spinner } from "../../components/ui";

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api.get<{ groupId: string; name: string; description: string | null; memberCount: number }>(`/invitations/${encodeURIComponent(code)}`),
    retry: false,
  });
  const accept = useAction(() => api.post<{ groupId: string }>(`/invitations/${encodeURIComponent(code)}/accept`), {
    invalidate: [["groups"], ["me"]],
    success: "You joined the group",
    onSuccess: (r) => navigate(`/groups/${r.groupId}`),
  });
  if (preview.isPending) return <Spinner />;
  if (preview.isError) return <ErrorState error={new Error("This invitation is invalid, expired, or used up.")} />;
  return (
    <div className="mx-auto max-w-md">
      <Card title="Group invitation">
        <p className="text-lg font-semibold">{preview.data.name}</p>
        {preview.data.description && <p className="mt-1 text-sm text-muted">{preview.data.description}</p>}
        <p className="mt-2 text-xs text-faint">{preview.data.memberCount} members</p>
        <p className="mt-4 text-xs text-muted">
          Members see your progress on shared work and count-only statistics (if leaderboards are on). Your personal tasks and schedule stay private.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
            Join group
          </Button>
          <Button variant="ghost" onClick={() => navigate("/groups")}>
            Not now
          </Button>
        </div>
      </Card>
    </div>
  );
}

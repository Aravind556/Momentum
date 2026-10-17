import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, Card, ErrorState, Spinner } from "../components/ui";

export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api.get<{ circleId: string; name: string; description: string | null; memberCount: number }>(`/invitations/${encodeURIComponent(code)}`),
    retry: false,
  });
  const accept = useAction(() => api.post<{ circleId: string }>(`/invitations/${encodeURIComponent(code)}/accept`), {
    invalidate: [["circles"], ["me"]],
    success: "You joined the Circle",
    onSuccess: (r) => navigate(`/circles/${r.circleId}`),
  });
  if (preview.isPending) return <Spinner />;
  if (preview.isError) return <ErrorState error={new Error("This invitation is invalid, expired, or used up.")} />;
  return (
    <div className="mx-auto max-w-md">
      <Card title="Circle invitation">
        <p className="text-lg font-semibold">{preview.data.name}</p>
        {preview.data.description && <p className="mt-1 text-sm text-muted">{preview.data.description}</p>}
        <p className="mt-2 text-xs text-faint">{preview.data.memberCount} members</p>
        <p className="mt-4 text-xs text-muted">
          Members see the activity you choose to share and count-only statistics (if leaderboards are on). Your personal tasks and schedule stay private.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
            Join Circle
          </Button>
          <Button variant="ghost" onClick={() => navigate("/circles")}>
            Not now
          </Button>
        </div>
      </Card>
    </div>
  );
}

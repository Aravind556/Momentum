import { useQuery } from "@tanstack/react-query";
import { Plus, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import type { Group } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Spinner, Textarea } from "../../components/ui";

export function GroupsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["groups"], queryFn: () => api.get<Group[]>("/groups") });
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Groups</h1>
          <p className="text-sm text-muted">Study together: share roadmaps, set group tasks, climb the leaderboard.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) navigate(`/join/${encodeURIComponent(code.trim().toUpperCase())}`);
            }}
          >
            <Input aria-label="Invitation code" placeholder="Invitation code" value={code} onChange={(e) => setCode(e.target.value)} className="w-40" />
            <Button type="submit" disabled={!code.trim()}>
              Join
            </Button>
          </form>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
            New group
          </Button>
        </div>
      </header>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data.length ? (
        <Card>
          <EmptyState
            title="No groups yet"
            description="Create a group for your batch or friends, share an invite code, and keep each other going."
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>Create a group</Button>}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`} className="block h-full rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{g.name}</p>
                  {g.role !== "member" && <Badge tone="accent">{g.role}</Badge>}
                </div>
                {g.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{g.description}</p>}
                <p className="mt-3 flex items-center gap-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden /> {g.memberCount}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular">
                    <Trophy className="size-3.5" aria-hidden />
                    {g.myRank ? `#${g.myRank} this week · ${g.myPoints} pts` : "No points yet"}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useAction(() => api.post<{ id: string }>("/groups", { name, description: description || null }), {
    invalidate: [["groups"], ["me"]],
    success: "Group created",
    onSuccess: (g) => {
      onClose();
      navigate(`/groups/${g.id}?tab=members`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New group"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="DSA Squad" maxLength={80} />}</Field>
        <Field label="Description" hint="Optional — what's the group working towards?">
          {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}
        </Field>
      </div>
    </Modal>
  );
}

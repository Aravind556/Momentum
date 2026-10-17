import { useQuery } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RANKING_MODES } from "@cadence/shared";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import type { Circle } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Select, Spinner, Textarea } from "../components/ui";

export const MODE_LABELS: Record<string, string> = { consistency: "Consistency", volume: "Volume", challenge: "Challenge progress", balanced: "Balanced" };

export function CirclesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["circles"], queryFn: () => api.get<Circle[]>("/circles") });
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Circles</h1>
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
            New Circle
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
            title="No Circles yet"
            description="Create a small private group for a shared goal — DSA prep, a study group, a 30-day challenge — and invite friends with a code."
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>Create a Circle</Button>}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((c) => (
            <li key={c.id}>
              <Link to={`/circles/${c.id}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{c.name}</p>
                  {c.role !== "member" && <Badge tone="accent">{c.role}</Badge>}
                </div>
                {c.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{c.description}</p>}
                <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
                  <Users className="size-3.5" aria-hidden /> {c.memberCount} members · ranks by {MODE_LABELS[c.settings.rankingMode]?.toLowerCase()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateCircleModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateCircleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("consistency");
  const create = useAction(() => api.post<{ id: string }>("/circles", { name, description: description || null, rankingMode: mode }), {
    invalidate: [["circles"], ["me"]],
    success: "Circle created",
    onSuccess: (c) => {
      onClose();
      navigate(`/circles/${c.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Circle"
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
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="DSA Preparation" maxLength={80} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}</Field>
        <Field label="Leaderboard ranking" hint="You can change this later.">
          {(id) => (
            <Select id={id} value={mode} onChange={(e) => setMode(e.target.value)}>
              {RANKING_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

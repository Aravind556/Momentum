/**
 * A tiny typed in-process event bus. Modules publish domain events after their transaction
 * commits; other modules subscribe in their `register` hook. New features react to events
 * without editing the code that emits them.
 */
export interface DomainEvents {
  "task.completed": { userId: string; taskId: string; outcome: "completed" | "partial"; verified: boolean; occurrenceKey: string };
  "task.reopened": { userId: string; taskId: string };
  "task.skipped": { userId: string; taskId: string };
  "task.changed": { userId: string; taskId: string | null };
  "availability.changed": { userId: string };
  "settings.changed": { userId: string };
  /** Something outside the user's own actions changed what today should hold (e.g. a group task). */
  "plan.stale": { userId: string };
  "submissions.synced": { userId: string; provider: string; newEvents: number };
  "roadmap.items_changed": { roadmapId: string };
  "roadmap.item_done": { userId: string; roadmapId: string; itemId: string; verifiedBy: "submission" | "self"; at: Date };
  "follow.changed": { userId: string; roadmapId: string };
  "group.tasks_changed": { groupId: string };
  "group.member_joined": { groupId: string; userId: string };
  "group.member_left": { groupId: string; userId: string };
}

export type EventName = keyof DomainEvents;
type Handler<K extends EventName> = (payload: DomainEvents[K]) => Promise<void> | void;

export class EventBus {
  private handlers = new Map<EventName, Handler<EventName>[]>();

  on<K extends EventName>(name: K, handler: Handler<K>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as Handler<EventName>);
    this.handlers.set(name, list);
    return () => this.handlers.set(name, (this.handlers.get(name) ?? []).filter((h) => h !== handler));
  }

  /** Runs handlers in registration order. A failing handler is logged and never breaks the emitter. */
  async emit<K extends EventName>(name: K, payload: DomainEvents[K]): Promise<void> {
    for (const h of this.handlers.get(name) ?? []) {
      try {
        await h(payload);
      } catch (err) {
        console.error(`[events] ${name} handler failed:`, err instanceof Error ? err.stack : err);
      }
    }
  }
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

/**
 * Per-request notes for the client, e.g. "your plan was updated: +1 item". Code deep inside an
 * event handler can add a note without every route knowing about it; the notes are sent as a
 * JSON response header (`x-cadence-notes`) that the web app turns into a toast.
 */
interface RequestNotes {
  notes: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestNotes>();

export function noteForResponse(key: string, merge: (prev: unknown) => unknown) {
  const store = storage.getStore();
  if (store) store.notes[key] = merge(store.notes[key]);
}

export const requestNotes: RequestHandler = (_req, res, next) => {
  const store: RequestNotes = { notes: {} };
  const send = res.json.bind(res);
  res.json = (body) => {
    if (Object.keys(store.notes).length && !res.headersSent) res.setHeader("x-cadence-notes", JSON.stringify(store.notes));
    return send(body);
  };
  storage.run(store, () => next());
};

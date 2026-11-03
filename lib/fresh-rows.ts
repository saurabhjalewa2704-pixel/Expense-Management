// A just-saved transaction gets a short entrance (UX polish §3 #2). Quick Add marks the client id; the row checks it while it mounts.
const marks = new Map<string, number>();
const WINDOW_MS = 1200;

export function markFresh(clientId: string) {
  const now = Date.now();
  for (const [k, t] of marks) if (now - t > WINDOW_MS) marks.delete(k);
  marks.set(clientId, now);
}

export const isFresh = (clientId: string) => { const t = marks.get(clientId); return t !== undefined && Date.now() - t < WINDOW_MS; };

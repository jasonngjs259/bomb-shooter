// Feature-tip queue + "seen" rule (framework-free; FeatureTips.tsx drives it,
// scripts/arena-ui-logic.ts tests it). One tip at a time, GAP_MS between
// tips, held during boss phase shifts. A tip only counts as SEEN when it was
// tapped, ran its full hold, or stayed on screen >= SEEN_MS. A tip cut short
// before that (Esc / pause / gate) goes back to the front of the queue and
// returns after resume, so a quick Esc never eats it.

export const TIP_SEEN_MS = 1500;
export const TIP_GAP_MS = 1500;

export type TipClose = "tap" | "timeout" | "interrupted";

export function tipCountsAsSeen(close: TipClose, shownMs: number): boolean {
  return close === "tap" || close === "timeout" || shownMs >= TIP_SEEN_MS;
}

export interface TipQueueDeps<T extends string> {
  want: (id: T) => boolean; // tips on and not seen yet
  markSeen: (id: T) => void;
  now: () => number;
}

export class TipQueue<T extends string> {
  private queue: T[] = [];
  private current: { id: T; shownAt: number; marked: boolean } | null = null;
  private nextAt = 0;
  private holdUntil = 0;

  constructor(private readonly deps: TipQueueDeps<T>) {}

  get showing(): T | null {
    return this.current?.id ?? null;
  }

  get pending(): readonly T[] {
    return this.queue;
  }

  push(id: T) {
    if (!this.deps.want(id) || this.queue.includes(id) || this.current?.id === id) return;
    this.queue.push(id);
  }

  // Boss phase shift etc.: no new tip for `ms`.
  holdFor(ms: number) {
    this.holdUntil = Math.max(this.holdUntil, this.deps.now() + ms);
  }

  // New level / end sequence: nothing queued survives (unseen tips come back
  // when their feature shows up again).
  clear() {
    if (this.current) this.close("interrupted");
    this.queue = [];
  }

  // The next tip to show now, or null (busy, gap, hold, nothing wanted).
  next(): T | null {
    const now = this.deps.now();
    if (this.current || now < this.nextAt || now < this.holdUntil) return null;
    let id: T | undefined;
    while ((id = this.queue.shift()) !== undefined && !this.deps.want(id));
    if (id === undefined) return null;
    this.current = { id, shownAt: now, marked: false };
    return id;
  }

  // Call while a tip is up: marks it seen once it has been on screen SEEN_MS.
  tick() {
    const c = this.current;
    if (c && !c.marked && this.deps.now() - c.shownAt >= TIP_SEEN_MS) {
      c.marked = true;
      this.deps.markSeen(c.id);
    }
  }

  close(reason: TipClose) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    const now = this.deps.now();
    this.nextAt = now + TIP_GAP_MS;
    if (c.marked) return;
    if (tipCountsAsSeen(reason, now - c.shownAt)) this.deps.markSeen(c.id);
    else this.queue.unshift(c.id);
  }
}

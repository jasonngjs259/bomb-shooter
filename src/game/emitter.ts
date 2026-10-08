// Minimal typed event emitter (no Node/DOM dependency).

type ListenerMap<E> = { [K in keyof E]?: Set<(payload: E[K]) => void> };

export class TypedEmitter<E extends object> {
  private listeners: ListenerMap<E> = {};

  // Subscribe; returns an unsubscribe function (handy as a useEffect cleanup).
  on<K extends keyof E>(event: K, cb: (payload: E[K]) => void): () => void {
    const set = this.listeners[event] ?? new Set<(payload: E[K]) => void>();
    this.listeners[event] = set;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]) {
    const set = this.listeners[event];
    if (!set) return;
    // Copy so listeners can unsubscribe while being called
    for (const cb of [...set]) cb(payload);
  }

  clear() {
    this.listeners = {};
  }
}

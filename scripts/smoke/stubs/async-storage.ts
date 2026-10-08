// Headless in-memory AsyncStorage (scripts/arena-smoke.ts only).
const mem = new Map<string, string>();
const AsyncStorage = {
  getItem: (k: string) => Promise.resolve(mem.get(k) ?? null),
  setItem: (k: string, v: string) => Promise.resolve(void mem.set(k, v)),
  multiGet: (keys: string[]) => Promise.resolve(keys.map((k) => [k, mem.get(k) ?? null] as [string, string | null])),
};
export default AsyncStorage;

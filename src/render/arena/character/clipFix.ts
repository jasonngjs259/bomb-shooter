// Loop seams: some pack loops end one key short of their start pose (the
// Astronaut's Run / Run_Left / Run_Right jump ~18 deg at the wrap). Close
// them by adding one key interval: open tracks get their first key again at
// the new end, already-closed tracks are stretched to the same length.

import { AnimationClip } from "three";

export function closeLoop(source: AnimationClip) {
  const clip = source.clone();
  let step = Infinity;
  let open = false;
  for (const t of clip.tracks) {
    const n = t.times.length;
    if (n < 2) continue;
    step = Math.min(step, t.times[1] - t.times[0]);
    const k = t.getValueSize();
    for (let i = 0; i < k && !open; i++) if (Math.abs(t.values[i] - t.values[(n - 1) * k + i]) > 1e-3) open = true;
  }
  if (!open || !Number.isFinite(step)) return source;
  const end = clip.duration + step;
  for (const t of clip.tracks) {
    const n = t.times.length;
    const k = t.getValueSize();
    const last = n > 0 ? t.times[n - 1] : 0;
    const closed = n < 2 || [...Array(k).keys()].every((i) => Math.abs(t.values[i] - t.values[(n - 1) * k + i]) <= 1e-3);
    if (closed || last < clip.duration - 1e-4) {
      // (key arrays can be shared between clones: always write new ones)
      const s = last > 0 ? end / clip.duration : 1;
      t.times = Float32Array.from(t.times, (x) => x * s);
      continue;
    }
    const times = new Float32Array(n + 1);
    times.set(t.times);
    times[n] = end;
    const values = new Float32Array((n + 1) * k);
    values.set(t.values);
    for (let i = 0; i < k; i++) values[n * k + i] = t.values[i];
    t.times = times;
    t.values = values;
  }
  clip.duration = end;
  return clip;
}

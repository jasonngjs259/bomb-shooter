// Guard for the Arena render-pass blocker: three r163+ defines methods like
// WebGLRenderer#render per instance, so calling them through `.prototype`
// throws. Fails if any source file calls a method via X.prototype.m.call/apply.
// Usage: node scripts/check-no-prototype-calls.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const files = walk(src);
const offenders = files.filter((f) => /\.prototype\.\w+\.(call|apply)\(/.test(readFileSync(f, "utf8")));
if (offenders.length) {
  console.error(`prototype method calls found:\n  ${offenders.join("\n  ")}`);
  process.exit(1);
}
console.log(`no prototype method calls in ${files.length} source files`);

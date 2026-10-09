// Guard for native (Expo Go / Hermes) startup crashes that no other check
// sees: Node has process.emitWarning, Buffer, fs...; `expo export` only
// bundles; web picks other package conditions. The first device test died at
// load with "[runtime not ready]: TypeError: undefined is not a function"
// because three's CJS build (build/three.cjs, what require("three") resolves
// to) calls process.emitWarning at module scope. metro.config.js now pins
// `three` to build/three.module.js; this script keeps it that way.
//
//   1. exports an unminified android dev bundle (no Hermes bytecode);
//   2. fails if the bundle contains three.cjs or any process.emitWarning() call, or
//      if more than one copy of three's core is bundled (duplicate three);
//   3. parses every module and reports module-scope (load-time, not inside a
//      function, not behind a typeof / try guard) use of Node- or DOM-only
//      APIs: process.* beyond env, Buffer, require("fs"|"path"|"crypto"|...),
//      document.*, window.*(...) calls, new TextDecoder / Worker /
//      OffscreenCanvas / ImageBitmap, createImageBitmap(), URL.createObjectURL();
//      anything not on the reviewed allow-list fails;
//   4. load test: runs the bundle in a Node vm context with NO `process`
//      global (Metro's prelude makes `process = {env}`, as on the device) and
//      a minimal RN-like global (stubbed nativeModuleProxy / TurboModules /
//      expo JSI object), then evaluates three, three/addons, the R3F native
//      entry, the Arena world/screen, App and the full app entry; any throw
//      or reported fatal fails.
//
// Usage: node scripts/check-native-bundle.mjs [--bundle path/to/android.js] [--keep]
//   --bundle  scan an existing unminified android bundle instead of exporting
//   --keep    keep the exported bundle (printed path)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const { parse } = require("@babel/parser");
const args = process.argv.slice(2);
const argBundle = args.includes("--bundle") ? args[args.indexOf("--bundle") + 1] : null;
const keep = args.includes("--keep");
const fails = [];
const fail = (msg) => fails.push(msg);

// ---- 1. bundle ------------------------------------------------------------------
let bundlePath = argBundle;
let outDir = null;
if (!bundlePath) {
  outDir = mkdtempSync(join(tmpdir(), "native-bundle-"));
  console.log("exporting an unminified android dev bundle...");
  execFileSync("npx", ["expo", "export", "--platform", "android", "--dev", "--no-minify", "--no-bytecode", "--output-dir", outDir], {
    cwd: root, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "1" },
  });
  const dir = join(outDir, "_expo", "static", "js", "android");
  bundlePath = join(dir, readdirSync(dir).find((f) => f.endsWith(".js")));
}
const src = readFileSync(bundlePath, "utf8");
console.log(`bundle: ${bundlePath} (${(src.length / 1e6).toFixed(1)} MB)`);

// ---- module table ------------------------------------------------------------------
// dev bundles: __d(function (global, require, ...) { body },<id>,[deps],"verbose/name");
const modules = [];
{
  const head = /__d\(function \(global, require, _\$\$_IMPORT_DEFAULT, _\$\$_IMPORT_ALL, module, exports, _dependencyMap\) \{\n/g;
  const starts = [...src.matchAll(head)].map((m) => m.index + m[0].length);
  const ends = [...src.matchAll(/\n\},(\d+),\[[^\]]*\],"([^"]+)"\)/g)];
  // each module ends at the last end marker before the next module starts
  let e = 0;
  for (let i = 0; i < starts.length; i++) {
    const limit = i + 1 < starts.length ? starts[i + 1] : src.length;
    let found = null;
    while (e < ends.length && ends[e].index < limit) found = ends[e++];
    if (found && found.index > starts[i]) modules.push({ id: +found[1], name: found[2], body: src.slice(starts[i], found.index) });
  }
}
if (modules.length < 100) fail(`could not split the bundle into modules (${modules.length}); is it an unminified dev bundle?`);
const byName = new Map(modules.map((m) => [m.name, m]));
console.log(`modules: ${modules.length}`);

// ---- 2. hard rules -----------------------------------------------------------------
for (const m of modules) {
  if (/three\.cjs$/.test(m.name)) fail(`three's CJS build is bundled (${m.name}): require("three") must resolve to build/three.module.js (metro.config.js)`);
  // calls only (src/polyfills.ts defines a no-op fallback)
  if (/\bprocess\.emitWarning\s*\(/.test(m.body)) fail(`process.emitWarning() call in ${m.name} (not available on React Native)`);
}
const cores = modules.filter((m) => /node_modules\/three\/build\/three\.(core|module|cjs)\.js$|three\.cjs$/.test(m.name)).map((m) => m.name);
const coreCopies = cores.filter((n) => /three\.(core\.js|cjs)$/.test(n));
if (cores.length && coreCopies.length !== 1) fail(`expected exactly one three core in the bundle, found: ${coreCopies.join(", ") || "none"}`);
console.log(`three builds bundled: ${cores.join(", ")}`);

// ---- 3. module-scope Node / DOM API use ------------------------------------------
// Reviewed and harmless on Hermes (module name -> reason). Keep this short.
const ALLOW = [
  // TextDecoder is installed by expo's winter runtime (expo/src/winter/runtime.native.ts)
  // before its lazy URL global first loads this module
  "node_modules/whatwg-url-minimum/dist/whatwg-url-minimum.mjs: new TextDecoder()",
];
const NODE_BUILTINS = /^(fs|path|crypto|os|child_process|stream|zlib|http|https|net|tls|worker_threads|node:.*)$/;
const findings = [];
const isFn = (n) => /Function|ArrowFunction|ClassMethod|ObjectMethod|ClassPrivateMethod/.test(n.type);
const guardTest = (n) => {
  // a typeof check (or a `"x" in y` check) anywhere in the condition
  let hit = false;
  const v = (x) => {
    if (!x || typeof x !== "object" || hit) return;
    if (x.type === "UnaryExpression" && x.operator === "typeof") hit = true;
    if (x.type === "BinaryExpression" && x.operator === "in") hit = true;
    // Platform.OS === "web" style branches
    if (x.type === "MemberExpression" && x.object.type === "Identifier" && /^(Platform|_Platform\w*)$/.test(x.object.name) && (x.property.name ?? x.property.value) === "OS") hit = true;
    if (x.type === "MemberExpression" && x.property && (x.property.name ?? x.property.value) === "OS" && x.object.type === "MemberExpression") hit = true;
    for (const k of Object.keys(x)) if (k !== "loc" && x[k] && typeof x[k] === "object") v(x[k]);
  };
  v(n);
  return hit;
};
const memberRoot = (n) => (n.type === "MemberExpression" && n.object.type === "Identifier" ? n.object.name : null);
const propName = (n) => (n.property && (n.property.name ?? n.property.value)) ?? "";
function scan(m) {
  if (/\.json$/.test(m.name)) return; // data modules
  let ast;
  try {
    ast = parse(m.body, { sourceType: "script", allowReturnOutsideFunction: true, errorRecovery: true, plugins: ["jsx"] });
  } catch (e) {
    findings.push({ m: m.name, what: `unparsable module (${e.message})` });
    return;
  }
  // names the module declares itself (e.g. the `buffer` polyfill's own Buffer)
  const own = new Set();
  for (const st of ast.program.body) {
    if ((st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id) own.add(st.id.name);
    if (st.type === "VariableDeclaration") for (const d of st.declarations) if (d.id.type === "Identifier") own.add(d.id.name);
  }
  const add = (what, rootName) => {
    if (rootName && own.has(rootName)) return;
    if (!findings.some((f) => f.m === m.name && f.what === what)) findings.push({ m: m.name, what });
  };
  const visit = (n, guarded) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x, guarded);
      return;
    }
    if (!n.type) return;
    if (isFn(n)) return; // not executed at load
    if (n.type === "ClassBody") {
      for (const el of n.body) if (el.static && el.value && !isFn(el.value)) visit(el.value, guarded); // static initialisers run at load
      return;
    }
    if (n.type === "IfStatement" || n.type === "ConditionalExpression") {
      const g = guarded || guardTest(n.test);
      visit(n.test, guarded);
      visit(n.consequent, g);
      visit(n.alternate, g);
      return;
    }
    if (n.type === "LogicalExpression") {
      visit(n.left, guarded);
      visit(n.right, guarded || guardTest(n.left));
      return;
    }
    if (n.type === "TryStatement") {
      visit(n.block, true);
      visit(n.handler, guarded);
      visit(n.finalizer, guarded);
      return;
    }
    if (!guarded) {
      const root = memberRoot(n);
      if (n.type === "MemberExpression" && root === "process" && !["env", "browser", "platform"].includes(propName(n))) {
        add(`process.${propName(n)}`, "process");
      }
      if (n.type === "MemberExpression" && (root === "Buffer" || root === "document")) add(`${root}.${propName(n)}`, root);
      if (n.type === "CallExpression") {
        const c = n.callee;
        if (c.type === "MemberExpression" && memberRoot(c) === "window") add(`window.${propName(c)}()`, "window");
        if (c.type === "MemberExpression" && memberRoot(c) === "URL" && propName(c) === "createObjectURL") add("URL.createObjectURL()", "URL");
        if (c.type === "Identifier" && (c.name === "Buffer" || c.name === "createImageBitmap")) add(`${c.name}()`, c.name);
        if (c.type === "Identifier" && c.name === "require" && n.arguments[0]?.type === "StringLiteral" && NODE_BUILTINS.test(n.arguments[0].value)) {
          add(`require("${n.arguments[0].value}")`, null);
        }
      }
      if (n.type === "NewExpression" && n.callee.type === "Identifier" && /^(TextDecoder|Worker|OffscreenCanvas|ImageBitmap|Buffer)$/.test(n.callee.name)) {
        add(`new ${n.callee.name}()`, n.callee.name);
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "extra" || k === "leadingComments" || k === "trailingComments") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v, guarded);
    }
  };
  visit(ast.program.body, false);
}
for (const m of modules) scan(m);
const unreviewed = findings.filter((f) => !ALLOW.some((a) => a === `${f.m}: ${f.what}`));
for (const f of unreviewed) fail(`module-scope ${f.what} in ${f.m}`);
console.log(`module-scope Node/DOM API uses: ${findings.length} (${findings.length - unreviewed.length} allow-listed)`);

// ---- 4. load test (no process global, minimal RN-like global) -------------------
const stub = (name = "stub") =>
  new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === "then") return undefined;
      if (k === "getConstants") return () => stub(`${name}.constants`);
      if (k === "scriptURL") return "http://localhost:8081/index.bundle?platform=android";
      if (k === "length") return 0;
      if (k === "__esModule") return false;
      return stub(`${name}.${String(k)}`);
    },
    apply: () => stub(`${name}()`),
    construct: () => stub(`new ${name}`),
  });
const g = {
  console: { ...console, log() {}, info() {}, warn() {}, debug() {}, error: (...a) => {
    // console.error'd exceptions (e.g. caught + logged at load); not RN's dev notices
    const line = a.map(String).join(" ");
    if (/\b(TypeError|ReferenceError|RangeError|SyntaxError)\b|is not a function|is not defined/.test(line)) logged.push(line);
  } },
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  requestAnimationFrame: (f) => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: (h) => clearTimeout(h),
  nativeModuleProxy: stub("nativeModuleProxy"), __turboModuleProxy: (n) => stub(`turbo:${n}`), nativeFabricUIManager: stub("fabric"),
  __fbBatchedBridgeConfig: { remoteModuleConfig: [] }, nativePerformanceNow: () => performance.now(), RN$Bridgeless: true,
  RN$registerCallableModule: () => {}, RN$enableMicrotasksInReact: true,
  // JSI host objects other native libraries install (the 2.5D branch's Skia / Reanimated)
  SkiaApi: stub("SkiaApi"), __workletsModuleProxy: stub("worklets"), __reanimatedModuleProxy: stub("reanimated"),
  TextEncoder, // Hermes ships TextEncoder; TextDecoder / URL come from expo's runtime polyfills
  // expo-modules-core JSI host object
  expo: {
    EventEmitter: class { addListener() { return { remove() {} }; } removeAllListeners() {} emit() {} listenerCount() { return 0; } },
    NativeModule: class {}, SharedObject: class {}, SharedRef: class {}, modules: stub("expo.modules"),
    uuidv4: () => "00000000-0000-4000-8000-000000000000", uuidv5: () => "00000000-0000-5000-8000-000000000000",
    getViewConfig: () => null, reloadAppAsync: async () => {},
  },
};
const logged = [];
g.global = g;
g.globalThis = g;
g.window = g; // React Native aliases window to global
const ctx = vm.createContext(g);
const tail = src.match(/(\n__r\(\d+\);)+(\n\/\/# [^\n]*)*\s*$/);
const entry = tail ? [...tail[0].matchAll(/__r\((\d+)\)/g)].map((m) => +m[1]) : [];
const errors = [];
try {
  vm.runInContext(tail ? src.slice(0, tail.index) : src, ctx, { filename: "android.bundle.js" });
  if (vm.runInContext("typeof process.emitWarning", ctx) !== "undefined" && !/polyfills/.test(src)) fail("vm: process.emitWarning exists without the app polyfill?");
  // capture fatals (RN's InitializeCore would install its own handler: keep ours)
  vm.runInContext("ErrorUtils", ctx).setGlobalHandler((e) => errors.push(e));
  vm.runInContext("ErrorUtils.setGlobalHandler = function () {};", ctx);
} catch (e) {
  fail(`vm: bundle prelude threw: ${e.message}`);
}
const load = (label, run) => {
  const before = errors.length + logged.length;
  try {
    run();
  } catch (e) {
    errors.push(e);
  }
  const fresh = errors.length + logged.length > before;
  if (fresh) {
    const msg = [...errors.splice(0).map((e) => `${e && e.message} @ ${String(e && e.stack).split("\n")[1]?.trim()}`), ...logged.splice(0)].join(" | ");
    fail(`vm: loading ${label} failed: ${msg}`);
  } else console.log(`  ok  loads ${label}`);
};
const req = (name) => {
  const m = byName.get(name);
  if (!m) throw new Error(`module ${name} not in the bundle`);
  return vm.runInContext(`__r(${m.id})`, ctx);
};
if (!fails.some((f) => f.startsWith("vm:"))) {
  for (const id of entry.slice(0, -1)) load(`entry prelude __r(${id})`, () => vm.runInContext(`__r(${id})`, ctx));
  for (const name of [
    ...(process.env.EXTRA_LOADS ? process.env.EXTRA_LOADS.split(",") : []),
    "node_modules/three/build/three.module.js",
    "node_modules/three/examples/jsm/loaders/GLTFLoader.js",
    "node_modules/three/examples/jsm/utils/SkeletonUtils.js",
    "node_modules/three/examples/jsm/utils/BufferGeometryUtils.js",
    "node_modules/@react-three/fiber/native/dist/react-three-fiber-native.cjs.dev.js",
    "src/render/arena/ArenaWorld.ts",
    "src/ui/arena/ArenaScreen.tsx",
    "App.tsx",
  ]) {
    if (byName.has(name)) load(name, () => req(name));
    else if (/three|fiber/.test(name) && cores.length) fail(`vm: ${name} is not in the bundle`);
  }
  if (entry.length) load(`app entry __r(${entry[entry.length - 1]})`, () => vm.runInContext(`__r(${entry[entry.length - 1]})`, ctx));
  // three + GLTFLoader export what the app uses
  if (cores.length) try {
    const three = req("node_modules/three/build/three.module.js");
    const gltf = req("node_modules/three/examples/jsm/loaders/GLTFLoader.js");
    if (!three.Vector3 || !gltf.GLTFLoader) fail("vm: three / GLTFLoader exports missing");
  } catch (e) {
    fail(`vm: three exports check threw: ${e.message}`);
  }
}

if (outDir && !keep) rmSync(outDir, { recursive: true, force: true });
if (fails.length) {
  console.error(`native bundle check FAILED (${fails.length}):\n  ${fails.join("\n  ")}`);
  process.exit(1);
}
console.log(`native bundle check: OK (${modules.length} modules, ${cores.length} three builds, 0 load-time throws)`);

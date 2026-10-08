// The one Node API the headless smoke uses (no @types/node in this app).
declare module "node:fs" {
  export function readFileSync(path: string | URL): Uint8Array;
}

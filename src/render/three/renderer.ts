// Renderer factory for every GL canvas (web + expo-gl), passed to R3F as
// `gl={createGameRenderer(attrs)}`.
//
// Why: three r163+ assigns `this.render = function ...` per instance inside
// the WebGLRenderer constructor; there is NO WebGLRenderer.prototype.render.
// R3F native then wraps gl.render so every call also presents the frame
// (endFrameEXP). A multi-pass frame (Arena: world, then radar) must draw the
// first pass without presenting, so we create the renderer ourselves and
// keep the instance's original render before anyone wraps it.

import { Camera, Object3D, WebGLRenderer, WebGLRendererParameters } from "three";
import "./quietThree";

type RenderFn = (scene: Object3D, camera: Camera) => void;
export interface Renderable {
  render: RenderFn;
}

const base = new WeakMap<object, RenderFn>();

// Keep `r.render` as it is now (call before anything wraps it).
export function registerBaseRender(r: Renderable) {
  if (!base.has(r)) base.set(r, r.render.bind(r));
}

export const hasBaseRender = (r: object) => base.has(r);

// Draw without presenting (native) - the original instance render. Falls
// back to the current render (which may present) if the renderer was not
// created through createGameRenderer.
export function renderNoPresent(r: Renderable, scene: Object3D, camera: Camera) {
  (base.get(r) ?? r.render.bind(r))(scene, camera);
}

export const createGameRenderer =
  (attrs: Omit<WebGLRendererParameters, "canvas">) =>
  (defaults: Omit<WebGLRendererParameters, "canvas"> & { canvas: unknown }): WebGLRenderer => {
    const r = new WebGLRenderer({ ...defaults, ...attrs, canvas: defaults.canvas as HTMLCanvasElement });
    registerBaseRender(r);
    return r;
  };

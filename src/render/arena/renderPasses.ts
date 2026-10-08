// The Arena frame's render passes, as a pure function (shared by the R3F
// canvas and the headless smoke in scripts/arena-smoke.ts): the world, then
// the radar into a scissored viewport. The first pass uses the renderer's
// original instance render (no present on native, see three/renderer.ts);
// the last pass goes through gl.render, which presents on native.

import { Camera, Object3D } from "three";
import { Renderable, renderNoPresent } from "../three/renderer";
import type { RadarRect } from "./ArenaWorld";

export interface PassRenderer extends Renderable {
  autoClear: boolean;
  clearDepth(): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  setScissorTest(on: boolean): void;
}

export function renderArenaFrame(
  gl: PassRenderer,
  scene: Object3D,
  camera: Camera,
  radar: { scene: Object3D; camera: Camera },
  rect: RadarRect | null,
  size: { width: number; height: number }
) {
  gl.autoClear = true;
  if (!rect) {
    gl.render(scene, camera);
    return;
  }
  renderNoPresent(gl, scene, camera);
  const y = size.height - rect.y - rect.size;
  gl.autoClear = false;
  gl.clearDepth();
  gl.setViewport(rect.x, y, rect.size, rect.size);
  gl.setScissor(rect.x, y, rect.size, rect.size);
  gl.setScissorTest(true);
  gl.render(radar.scene, radar.camera);
  gl.setScissorTest(false);
  gl.setViewport(0, 0, size.width, size.height);
  gl.autoClear = true;
}

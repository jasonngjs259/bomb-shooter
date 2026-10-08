// Draw calls a scene graph will issue, counted the way three's WebGLRenderer
// issues them (for the headless smoke and the in-app QA stats): every visible
// Mesh / Points / Line with something to draw is one call per material
// group, and a transparent double-sided material without forceSinglePass is
// drawn twice (back faces, then front). Empty instanced meshes (count 0,
// instanceCount 0) and empty draw ranges cost nothing. An upper bound: it
// ignores frustum culling (the Arena turns it off almost everywhere).

import {
  BufferGeometry, DoubleSide, InstancedBufferGeometry, InstancedMesh, Line, Material, Mesh, Object3D, Points,
} from "three";

const drawsFor = (m: Material) => (m.transparent && m.side === DoubleSide && !m.forceSinglePass ? 2 : 1);

export function countDraws(root: Object3D): number {
  let n = 0;
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    const r = o as Mesh | Points | Line;
    if ((r as Mesh).isMesh || (r as Points).isPoints || (r as Line).isLine) {
      const g = r.geometry as BufferGeometry;
      const im = o as InstancedMesh;
      const ig = g as InstancedBufferGeometry;
      const empty =
        (im.isInstancedMesh && im.count === 0) ||
        (ig.isInstancedBufferGeometry && ig.instanceCount === 0) ||
        g.drawRange.count === 0 ||
        (!g.index && !g.getAttribute("position"));
      if (!empty) {
        const mats = Array.isArray(r.material) ? r.material : [r.material];
        if (Array.isArray(r.material) && g.groups.length) {
          for (const grp of g.groups) {
            const m = mats[grp.materialIndex ?? 0];
            if (m && m.visible) n += drawsFor(m);
          }
        } else if (mats[0] && mats[0].visible) n += drawsFor(mats[0]);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return n;
}

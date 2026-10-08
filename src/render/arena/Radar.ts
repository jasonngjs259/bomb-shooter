// Heading-up radar (spec section 3.3), drawn inside the GL canvas as a
// second pass into a scissored viewport (no per-frame React/SVG nodes).
// Radar space is the ground plane scaled so 18 w = radius 1, looked at from
// above with an orthographic camera; the content group is rotated so the
// player's facing points up. Contents: panel disc + cyan rim, arena border,
// the 16-sector danger arc (same shader as the ground ring), bombs as
// coloured dots (one Points draw), the player triangle and view cone.

import {
  BufferAttribute, BufferGeometry, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial,
  OrthographicCamera, Points, PointsMaterial, RingGeometry, Scene, ShaderMaterial, ShapeGeometry, Shape,
} from "three";
import type { ArenaEngine } from "../../game/arena";
import { DEG, modelRotationY } from "../../arena/arenaMath";
import { bombBase, colorAt, HEX } from "../three/palette";
import { makeDangerRingMaterial } from "./Ground";

const RANGE = 18;
const MAX_DOTS = 160;

const flat = <T extends RingGeometry | CircleGeometry | ShapeGeometry>(g: T) => {
  g.rotateX(-Math.PI / 2);
  return g;
};

export class Radar {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1.04, 1.04, 1.04, -1.04, 0.1, 10);
  private readonly content = new Group();
  private readonly pos = new Float32Array(MAX_DOTS * 3);
  private readonly col = new Float32Array(MAX_DOTS * 3);
  private readonly dotsGeo = new BufferGeometry();
  private readonly dotsMat: PointsMaterial;
  private readonly danger: ShaderMaterial;
  private readonly player = new Group();
  private readonly cone: Mesh;
  private readonly disposables: { dispose: () => void }[] = [];

  constructor(arenaR: number) {
    this.camera.position.set(0, 5, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    const mesh = <G extends BufferGeometry>(g: G, m: MeshBasicMaterial | ShaderMaterial, y: number, parent: Group | Scene) => {
      const o = new Mesh(g, m);
      o.position.y = y;
      parent.add(o);
      this.disposables.push(g, m);
      return o;
    };
    const basic = (color: string, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false, depthTest: false, side: DoubleSide });
    mesh(flat(new CircleGeometry(1, 64)), basic(HEX.boardBack, 0.82), 0, this.scene);
    mesh(flat(new RingGeometry(0.985, 1.02, 64)), basic(HEX.cyan, 1), 0.01, this.scene);
    this.scene.add(this.content);
    const br = arenaR / RANGE;
    mesh(flat(new RingGeometry(br - 0.012, br + 0.012, 64)), basic(HEX.cyan, 0.7), 0.02, this.content);
    this.danger = makeDangerRingMaterial();
    this.danger.depthTest = false;
    mesh(flat(new RingGeometry(0.9, 0.975, 96)), this.danger, 0.03, this.content);

    this.dotsGeo.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.dotsGeo.setAttribute("color", new BufferAttribute(this.col, 3));
    this.dotsMat = new PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest: false, toneMapped: false });
    const dots = new Points(this.dotsGeo, this.dotsMat);
    dots.frustumCulled = false;
    this.content.add(dots);
    this.disposables.push(this.dotsGeo, this.dotsMat);

    const tri = new Shape();
    tri.moveTo(0, 0.075);
    tri.lineTo(-0.05, -0.045);
    tri.lineTo(0.05, -0.045);
    tri.closePath();
    const triGeo = new ShapeGeometry(tri);
    triGeo.rotateX(-Math.PI / 2); // shape +y -> -z
    triGeo.rotateY(Math.PI); // point along +z (model forward)
    mesh(triGeo, basic(HEX.white, 1), 0.06, this.player);
    this.cone = mesh(flat(new CircleGeometry(0.55, 24, 0, 1)), basic(HEX.white, 0.08), 0.05, this.player);
    this.content.add(this.player);
  }

  update(engine: ArenaEngine, hFovDeg: number) {
    const s = engine.getShooter();
    this.content.rotation.y = s.yaw + Math.PI / 2; // facing -> screen up (-z)
    const arr = this.danger.uniforms.uDanger.value as number[];
    const sectors = engine.getDangerByAngle(16);
    for (let i = 0; i < 16; i++) arr[i] = sectors[i] ?? 0;
    let n = 0;
    for (const b of engine.getBombs()) {
      if (b.state !== "idle" || n >= MAX_DOTS) continue;
      const c: Color = colorAt(bombBase, b.colorIndex);
      this.pos[n * 3] = Math.max(-1, Math.min(1, b.x / RANGE));
      this.pos[n * 3 + 1] = 0.04;
      this.pos[n * 3 + 2] = Math.max(-1, Math.min(1, b.z / RANGE));
      this.col[n * 3] = c.r; this.col[n * 3 + 1] = c.g; this.col[n * 3 + 2] = c.b;
      n++;
    }
    this.dotsGeo.setDrawRange(0, n);
    this.dotsGeo.getAttribute("position").needsUpdate = true;
    this.dotsGeo.getAttribute("color").needsUpdate = true;
    this.player.position.set(s.x / RANGE, 0, s.z / RANGE);
    this.player.rotation.y = modelRotationY(s.yaw);
    // view cone: circle sector centred on local +z
    const half = (hFovDeg * DEG) / 2;
    const g = this.cone.geometry as CircleGeometry;
    if (g.parameters.thetaLength !== half * 2) {
      g.dispose();
      const ng = flat(new CircleGeometry(0.55, 24, Math.PI / 2 - half, half * 2));
      ng.rotateY(Math.PI); // centred on local +z (model forward)
      this.cone.geometry = ng;
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.cone.geometry.dispose();
  }
}

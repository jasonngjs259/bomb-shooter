// Classic 3D launcher: a neon turret. A dark-violet pedestal with a glowing
// cyan rim, a dome on top outlined in the loaded bomb's glow colour, and a
// thick barrel that pivots from the dome centre on a cyan hinge collar,
// with magenta trim bands and a glowing muzzle collar. The current bomb sits
// loaded in the muzzle; the next bomb waits in a socket on the turret's left
// side (the engine's next slot, so taps on it hit-test where it is drawn).
// The barrel springs toward the aim angle and recoils on fire.
//
// Aim stays exact: the pivot is the engine's shooter point and the muzzle
// is the engine's launch point (MUZZLE_OFFSET along the aim: the engine's
// loaded bomb, shot start and aim path all begin there). Barrel, loaded and
// in-flight bombs live on the board plane (z = 0). On fire the barrel snaps
// to the engine angle, so the shot leaves exactly where the loaded bomb was
// drawn (no jump); the aim dots start just past the loaded bomb.
//
// Loaded / next / in-flight bombs use the board bomb material (emissive
// 0.35, no shooter point light: that washed them out).

import {
  Color, CylinderGeometry, DoubleSide, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry,
  TorusGeometry, Vector3,
} from "three";
import { AIM_MAX_ANGLE, AIM_MIN_ANGLE, MUZZLE_OFFSET } from "../../../game/constants";
import { BombState, NextBombState, ShooterState } from "../../../game/types";
import { BombBatch } from "./BombBatch";
import { bombGlow, colorAt, HEX } from "../palette";
import { DEG, clamp01, easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuad, lerp } from "./easing";

export const MUZZLE = MUZZLE_OFFSET; // pivot -> loaded bomb centre (board units)
const BARREL_LEN = MUZZLE - 6; // ends inside the muzzle cup the bomb sits in
export const AIM_SKIP = 22; // aim path starts at the muzzle: dots start past the loaded bomb
const LOADED = 0.85; // loaded bomb scale (board bomb = 1)
const NEXT = 0.62; // next bomb scale in the socket
// Same emissive as board bombs (BombBatch board default).
export const BOMB_GLOW = 0.35;
const BODY = "#2A1F52";
const BARREL = "#4A3A8F"; // lighter violet so the barrel reads against the dark dome
const VIOLET = new Color(HEX.panelBorder);
const BODY_DARK = "#1B1236";

export class Cannon {
  readonly group = new Group();
  private readonly barrelPivot = new Group();
  private readonly slide = new Group(); // barrel parts that recoil
  private readonly barrel: Mesh;
  private readonly muzzle: Mesh;
  private readonly dome: Mesh;
  private readonly outline: Mesh;
  private readonly socket = new Group();
  private readonly glowColor = new Color(HEX.cyan);
  private readonly emissive = new Color();
  private readonly tmp = new Color();
  private readonly materials: Material[] = [];
  private readonly muzzleMat: MeshBasicMaterial;
  private readonly outlineMat: MeshBasicMaterial;
  private angle = 90; // displayed barrel angle (deg)
  private tintIndex = 0; // bomb colour the turret glow shows
  private omega = 0;
  private recoil = 0;
  private recoilT = 99;
  private flashT = 99;
  private reloadT = 99;
  private swapT = 99;
  private prevVisible = true;
  private nextDX = -72;
  private nextDY = -18; // world y (up) offset of the socket

  constructor() {
    const reg = <T extends Material>(m: T) => {
      this.materials.push(m);
      return m;
    };
    const basic = (c: string, opacity = 1) =>
      reg(new MeshBasicMaterial({ color: c, toneMapped: false, fog: false, transparent: opacity < 1, opacity }));
    const add = (parent: Group, mesh: Mesh, x: number, y: number, z: number) => {
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // Pedestal (fully on the board: spans y -40..-4) with a cyan rim line
    const pedestal = new Mesh(
      new CylinderGeometry(38, 46, 36, 40),
      reg(new MeshStandardMaterial({ color: BODY_DARK, metalness: 0.5, roughness: 0.45, fog: false }))
    );
    add(this.group, pedestal, 0, -22, -26);
    const rimGeo = new TorusGeometry(38, 1.6, 6, 64);
    rimGeo.rotateX(Math.PI / 2);
    add(this.group, new Mesh(rimGeo, basic(HEX.cyan)), 0, -4, -26);
    const footGeo = new TorusGeometry(46, 1.2, 6, 64);
    footGeo.rotateX(Math.PI / 2);
    add(this.group, new Mesh(footGeo, basic(HEX.magenta, 0.7)), 0, -40, -26);

    // Dome on the pedestal, outlined in the glow colour
    this.dome = new Mesh(
      new SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      reg(new MeshStandardMaterial({ color: BODY, metalness: 0.45, roughness: 0.3, fog: false }))
    );
    this.dome.scale.set(34, 28, 24);
    add(this.group, this.dome, 0, -4, -26);
    this.outlineMat = basic(HEX.cyan);
    this.outline = new Mesh(new TorusGeometry(34, 1.5, 8, 48, Math.PI), this.outlineMat);
    this.outline.scale.set(1, 28 / 34, 1);
    add(this.group, this.outline, 0, -4, -6);

    // Barrel (board plane), pivoting at the origin = engine shooter point
    const barrelGeo = new CylinderGeometry(13, 16, BARREL_LEN, 28);
    barrelGeo.translate(0, BARREL_LEN / 2, 0);
    this.barrel = new Mesh(barrelGeo, reg(new MeshStandardMaterial({ color: BARREL, metalness: 0.35, roughness: 0.35, fog: false })));
    this.slide.add(this.barrel);
    // magenta trim bands (radius follows the taper, slightly proud of it)
    for (const y of [11, 23]) {
      const r = 16 - (3 * y) / BARREL_LEN + 0.8;
      add(this.slide, new Mesh(new CylinderGeometry(r, r, 3.2, 28), basic(HEX.magenta)), 0, y, 0);
    }
    // glowing muzzle cup (bomb colour): the loaded bomb sits ~25% inside it
    // (cup y 34..48, bomb centre at MUZZLE = 52, radius 16)
    this.muzzleMat = basic(HEX.cyan);
    this.muzzle = new Mesh(new CylinderGeometry(19.5, 15, 14, 32, 1, true), this.muzzleMat);
    this.muzzleMat.side = DoubleSide;
    add(this.slide, this.muzzle, 0, MUZZLE - 11, 0);
    const lip = new TorusGeometry(19.5, 1.8, 8, 32);
    lip.rotateX(Math.PI / 2);
    add(this.slide, new Mesh(lip, basic(HEX.white, 0.85)), 0, MUZZLE - 4, 0);
    this.barrelPivot.add(this.slide);
    this.group.add(this.barrelPivot);

    // Hinge collar at the pivot, in front of the barrel base
    add(this.group, new Mesh(new SphereGeometry(9, 20, 12), reg(new MeshStandardMaterial({ color: BARREL, metalness: 0.5, roughness: 0.3, emissive: HEX.panelBorder, emissiveIntensity: 0.25, fog: false }))), 0, 0, 10);
    add(this.group, new Mesh(new TorusGeometry(11, 2.6, 10, 32), basic(HEX.cyan)), 0, 0, 14);

    // NEXT socket on the left side, joined to the pedestal by a short arm
    this.socket.add(new Mesh(new TorusGeometry(15, 1.6, 8, 40), basic(HEX.panelBorder)));
    const arm = new Mesh(new CylinderGeometry(2.2, 2.2, 36, 8), basic(HEX.panelBorder, 0.85));
    arm.rotation.z = Math.PI / 2;
    add(this.socket, arm, 33, 0, -4); // ring edge -> pedestal side
    this.group.add(this.socket);
  }

  // Next slot relative to the launcher, in board units (engine y is down).
  setNextOffset(dx: number, dy = 0) {
    this.nextDX = dx;
    this.nextDY = -dy;
    this.socket.position.set(dx, -dy, -8);
  }

  // angle: the engine's aim at launch; the barrel snaps to it so the shot
  // starts exactly at the drawn muzzle.
  onShoot(angle?: number) {
    if (angle !== undefined) {
      this.angle = Math.max(AIM_MIN_ANGLE, Math.min(AIM_MAX_ANGLE, angle));
      this.omega = 0;
      this.barrelPivot.rotation.z = (this.angle - 90) * DEG;
    }
    this.recoilT = 0;
    this.flashT = 0;
  }

  onSwap() {
    this.swapT = 0;
  }

  // World position of the loaded bomb / muzzle (recoil included).
  muzzleWorld(out: Vector3) {
    const a = this.angle * DEG;
    const d = MUZZLE + this.recoil;
    out.set(Math.cos(a) * d, Math.sin(a) * d, 0);
    return out.add(this.group.position);
  }

  update(dt: number, shooter: ShooterState, bomb: BombState, flashOn: boolean) {
    this.group.position.set(shooter.x, -shooter.y, 0);
    // Barrel spring toward the aim (stiffness 400, damping 30), clamped +-80
    const target = Math.max(AIM_MIN_ANGLE, Math.min(AIM_MAX_ANGLE, shooter.angle));
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.omega += (400 * (target - this.angle) - 30 * this.omega) * h;
      this.angle += this.omega * h;
    }
    this.barrelPivot.rotation.z = (this.angle - 90) * DEG;

    // Recoil: -8u in 60ms (easeOutQuad), back in 180ms (easeOutBack)
    this.recoilT += dt;
    const rt = this.recoilT * 1000;
    this.recoil = rt < 60 ? -8 * easeOutQuad(rt / 60) : -8 * (1 - easeOutBack(clamp01((rt - 60) / 180)));
    this.slide.position.y = this.recoil;
    const squash = rt < 60 ? lerp(1, 0.95, rt / 60) : lerp(0.95, 1, easeOutCubic(clamp01((rt - 60) / 160)));
    this.dome.scale.y = 28 * squash;

    // Glow colour follows the loaded bomb (~150ms crossfade)
    // collar / dome colour changes when the incoming bomb ARRIVES in the
    // muzzle (end of the swap or reload slide), crossfading over ~150 ms
    const arriving = this.swapT < 0.22 || (bomb.visible && !bomb.inFlight && this.reloadT < 0.16);
    if (!arriving) this.tintIndex = bomb.colorIndex;
    this.glowColor.lerp(colorAt(bombGlow, this.tintIndex), 1 - Math.exp(-dt * 20));
    this.muzzleMat.color.copy(this.glowColor);
    this.outlineMat.color.copy(this.glowColor);
    this.flashT += dt;
    const ft = this.flashT * 1000;
    const flash = flashOn ? (ft < 40 ? ft / 40 : ft < 120 ? 1 - (ft - 40) / 80 : 0) : 0;
    // soft emissive glow in the bomb colour, flaring briefly on fire
    this.emissive.copy(VIOLET).multiplyScalar(0.16).add(this.tmp.copy(this.glowColor).multiplyScalar(0.05 + 0.5 * flash));
    (this.barrel.material as MeshStandardMaterial).emissive.copy(this.emissive);
    this.emissive.copy(this.glowColor).multiplyScalar(0.08 + 0.3 * flash);
    (this.dome.material as MeshStandardMaterial).emissive.copy(this.emissive);

    // Reload starts when the bomb reappears loaded after a shot
    if (bomb.visible && !bomb.inFlight && !this.prevVisible) this.reloadT = 0;
    this.prevVisible = bomb.visible;
    this.reloadT += dt;
    this.swapT += dt;
  }

  // Loaded + next bombs. `flicker` = spark flicker scale.
  submitBombs(batch: BombBatch, bomb: BombState, next: NextBombState, shooter: ShooterState, flicker: number) {
    const d = batch.draw;
    const sx = shooter.x;
    const sy = -shooter.y;
    const nx = sx + this.nextDX;
    const ny = sy + this.nextDY;
    const a = this.angle * DEG;
    const md = MUZZLE + this.recoil;
    const mx = sx + Math.cos(a) * md;
    const my = sy + Math.sin(a) * md;
    const reload = clamp01((this.reloadT * 1000) / 160);
    const popIn = clamp01((this.reloadT * 1000) / 200);
    const swap = clamp01((this.swapT * 1000) / 220);
    const swapping = swap < 1;
    const se = easeInOutCubic(swap);
    const arc = Math.sin(Math.PI * se) * 26; // swap arcs bow upward/downward

    const reset = () => {
      d.rotX = 0; d.rotY = 0; d.rotZ = 0; d.squash = 0; d.tint = 0; d.halo = 1; d.shadow = false; d.z = 0;
    };

    // Next bomb in its socket (muzzle -> socket on a swap)
    reset();
    if (swapping) {
      d.x = lerp(mx, nx, se); d.y = lerp(my, ny, se) - arc; d.scale = lerp(LOADED, NEXT, se);
    } else {
      d.x = nx; d.y = ny; d.scale = NEXT * Math.max(0, easeOutBack(popIn));
    }
    d.colorIndex = next.colorIndex; d.glow = BOMB_GLOW; d.spark = flicker * 0.9; d.z = -2;
    batch.add();

    if (!bomb.visible) return;
    reset();
    d.colorIndex = bomb.colorIndex;
    d.glow = BOMB_GLOW;
    d.spark = flicker;
    if (bomb.inFlight) {
      // the engine launches from the muzzle: draw it where it is, growing
      // from the loaded size to full size over the first ~50 ms
      d.x = bomb.x; d.y = -bomb.y; d.scale = lerp(LOADED, 1, clamp01(this.flashT / 0.05));
      d.rotZ = (this.angle - 90) * DEG * (1 - clamp01(this.flashT / 0.15));
      d.shadow = true;
    } else if (swapping) {
      d.x = lerp(nx, mx, se); d.y = lerp(ny, my, se) + arc; d.scale = lerp(NEXT, LOADED, se);
    } else {
      const e = easeOutCubic(reload);
      d.x = lerp(nx, mx, e); d.y = lerp(ny, my, e); d.scale = lerp(NEXT, LOADED, e);
      d.rotZ = (this.angle - 90) * DEG;
    }
    batch.add();
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
  }
}

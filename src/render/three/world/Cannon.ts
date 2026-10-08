// 3D launcher: domed turret with a neon ring in the loaded bomb's glow
// colour, a barrel that springs toward the aim angle and recoils on fire, a
// muzzle ring, the NEXT socket and the shooter point light. It also places
// the loaded and next bombs (reload slide, pop-in, swap arcs).

import {
  Color, CylinderGeometry, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight,
  SphereGeometry, TorusGeometry, Vector3,
} from "three";
import { BombState, NextBombState, ShooterState } from "../../../game/types";
import { BombBatch } from "./BombBatch";
import { bombGlow, color, colorAt, HEX } from "../palette";
import { DEG, clamp01, easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuad, lerp } from "./easing";

const BARREL_LEN = 58;
const LIGHT_BASE = 6.3; // spec 2.0 (legacy units) x PI
const LIGHT_FLASH = 19;

export class Cannon {
  readonly group = new Group();
  private readonly barrelPivot = new Group();
  private readonly barrel: Mesh;
  private readonly muzzle: Mesh;
  private readonly dome: Mesh;
  private readonly ring: Mesh;
  private readonly socket: Mesh;
  readonly light: PointLight;
  private readonly glowColor = new Color();
  private readonly materials: Material[] = [];
  private angle = 90; // displayed barrel angle (deg)
  private omega = 0;
  private recoilT = 99;
  private flashT = 99;
  private reloadT = 99;
  private swapT = 99;
  private prevVisible = true;
  private nextOffsetX = -110;

  constructor() {
    const reg = <T extends Material>(m: T) => {
      this.materials.push(m);
      return m;
    };
    const barrelGeo = new CylinderGeometry(9, 11, BARREL_LEN, 20);
    barrelGeo.translate(0, BARREL_LEN / 2, 0);
    this.barrel = new Mesh(barrelGeo, reg(new MeshStandardMaterial({ color: HEX.slabTop, metalness: 0.7, roughness: 0.3, fog: false })));
    this.barrel.position.z = -14;
    const muzzleGeo = new TorusGeometry(13, 2.6, 10, 28);
    muzzleGeo.rotateX(Math.PI / 2);
    muzzleGeo.translate(0, BARREL_LEN, 0);
    this.muzzle = new Mesh(muzzleGeo, reg(new MeshBasicMaterial({ color: "#ffffff", toneMapped: false, fog: false })));
    this.muzzle.position.z = -14;
    this.barrelPivot.add(this.barrel, this.muzzle);

    const domeGeo = new SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    this.dome = new Mesh(domeGeo, reg(new MeshStandardMaterial({ color: "#2A1F52", metalness: 0.5, roughness: 0.35, fog: false })));
    this.dome.scale.set(40, 34, 26);
    this.dome.position.set(0, -44, -8);
    this.ring = new Mesh(
      new TorusGeometry(42, 1.8, 8, 48, Math.PI),
      reg(new MeshBasicMaterial({ color: "#ffffff", toneMapped: false, fog: false }))
    );
    this.ring.scale.set(1, 0.86, 1);
    this.ring.position.set(0, -44, -6);
    this.socket = new Mesh(
      new TorusGeometry(19, 1.3, 8, 40),
      reg(new MeshBasicMaterial({ color: HEX.panelBorder, toneMapped: false, fog: false, transparent: true, opacity: 0.8 }))
    );
    this.light = new PointLight("#ffffff", LIGHT_BASE, 260, 0);
    this.light.position.set(0, 0, 40);
    this.group.add(this.dome, this.ring, this.barrelPivot, this.socket, this.light);
  }

  setNextOffset(dx: number) {
    this.nextOffsetX = dx;
    this.socket.position.set(dx, 0, -12);
  }

  onShoot() {
    this.recoilT = 0;
    this.flashT = 0;
  }

  onSwap() {
    this.swapT = 0;
  }

  // World position of the muzzle tip.
  muzzleWorld(out: Vector3) {
    const a = this.angle * DEG;
    out.set(Math.cos(a) * BARREL_LEN, Math.sin(a) * BARREL_LEN, 0);
    return out.add(this.group.position);
  }

  update(dt: number, shooter: ShooterState, bomb: BombState, lightOn: boolean) {
    this.group.position.set(shooter.x, -shooter.y, 0);
    // Barrel spring toward the aim (stiffness 400, damping 30), clamped +-80
    const target = Math.max(10, Math.min(170, shooter.angle));
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
    const recoil = rt < 60 ? -8 * easeOutQuad(rt / 60) : -8 * (1 - easeOutBack(clamp01((rt - 60) / 180)));
    this.barrel.position.y = recoil;
    this.muzzle.position.y = recoil;
    const squash = rt < 60 ? lerp(1, 0.94, rt / 60) : lerp(0.94, 1, easeOutCubic(clamp01((rt - 60) / 160)));
    this.dome.scale.y = 34 * squash;

    // Glow colour follows the loaded bomb (~150ms crossfade)
    const target3 = colorAt(bombGlow, bomb.colorIndex);
    this.glowColor.lerp(target3, 1 - Math.exp(-dt * 20));
    (this.ring.material as MeshBasicMaterial).color.copy(this.glowColor);
    (this.muzzle.material as MeshBasicMaterial).color.copy(this.glowColor);
    this.light.color.copy(this.glowColor);
    this.flashT += dt;
    const ft = this.flashT * 1000;
    const flash = ft < 40 ? ft / 40 : ft < 120 ? 1 - (ft - 40) / 80 : 0;
    this.light.intensity = lerp(LIGHT_BASE, LIGHT_FLASH, flash);
    this.light.visible = lightOn;

    // Reload starts when the bomb reappears loaded after a shot
    if (bomb.visible && !bomb.inFlight && !this.prevVisible) this.reloadT = 0;
    this.prevVisible = bomb.visible;
    this.reloadT += dt;
    this.swapT += dt;
  }

  // Loaded + next bombs. `pulse` = spark flicker scale for these two.
  submitBombs(batch: BombBatch, bomb: BombState, next: NextBombState, shooter: ShooterState, flicker: number) {
    const d = batch.draw;
    const sx = shooter.x;
    const sy = -shooter.y;
    const nx = sx + this.nextOffsetX;
    const reload = clamp01((this.reloadT * 1000) / 160);
    const popIn = clamp01((this.reloadT * 1000) / 200);
    const swap = clamp01((this.swapT * 1000) / 220);
    const swapping = swap < 1;
    const se = easeInOutCubic(swap);

    const reset = () => {
      d.rotX = 0; d.rotY = 0; d.rotZ = 0; d.squash = 0; d.tint = 0; d.halo = 1; d.shadow = false; d.z = 0;
    };

    // Next bomb in its socket
    reset();
    let nScale = 0.75 * Math.max(0, easeOutBack(popIn));
    let npx = nx;
    let npy = sy;
    if (swapping) {
      // pivot -> socket along the lower arc
      const a = Math.PI * se;
      const cx = (sx + nx) / 2;
      const r = (sx - nx) / 2;
      npx = cx + Math.cos(a) * r;
      npy = sy - Math.sin(a) * r * 0.7;
      nScale = lerp(1, 0.75, se);
    }
    d.x = npx; d.y = npy; d.scale = nScale; d.colorIndex = next.colorIndex; d.glow = 0.35; d.spark = flicker * 0.9;
    batch.add();

    if (!bomb.visible) return;
    reset();
    d.colorIndex = bomb.colorIndex;
    d.glow = 0.9;
    d.spark = flicker;
    if (bomb.inFlight) {
      d.x = bomb.x; d.y = -bomb.y; d.scale = 1; d.rotZ = -(this.angle - 90) * DEG * 0.3;
      d.shadow = true;
    } else if (swapping) {
      const a = Math.PI * se;
      const cx = (sx + nx) / 2;
      const r = (sx - nx) / 2;
      d.x = cx - Math.cos(a) * r; d.y = sy + Math.sin(a) * r * 0.7; d.scale = lerp(0.75, 1, se);
    } else {
      const e = easeOutCubic(reload);
      d.x = lerp(nx, sx, e); d.y = sy; d.scale = lerp(0.75, 1, e);
      d.rotZ = (this.angle - 90) * DEG * 0.35;
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

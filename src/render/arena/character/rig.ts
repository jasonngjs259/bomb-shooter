// Rig config for the Arena character (character spec section 1): bone and
// clip roles (exact name first, then a regex alias, first match wins),
// measured gait data and the material roles. The defaults are tuned for the
// Quaternius "Ultimate Modular Men" rig (Astronaut); another Quaternius /
// KayKit rig only needs new names here.

import type { AnimationClip, Object3D } from "three";

export type BoneRole =
  | "body" | "hips" | "spine" | "chest" | "upperChest" | "neck" | "head"
  | "shoulderL" | "upperArmL" | "shoulderR" | "upperArmR" | "handR"
  | "upperLegL" | "lowerLegL" | "footL" | "upperLegR" | "lowerLegR" | "footR";

export type ClipRole =
  | "idle" | "aim" | "walkF" | "runF" | "back" | "strafeL" | "strafeR" | "runAim" | "shoot" | "hit" | "death" | "win";

export type MaterialRole = "suit" | "plates" | "trim" | "visor";

export interface RigConfig {
  height: number; // world units after scaling
  upperRoot: string; // upper-body mask = this bone and its children
  bones: Record<BoneRole, [string, RegExp]>;
  clips: Record<ClipRole, [string, RegExp]>;
  // normalised clip time at which the left foot touches down (phase sync)
  phaseOffset: Partial<Record<ClipRole, number>>;
  // ground speed the clip was authored for, w/s at `height` (foot plant)
  nativeSpeed: Partial<Record<ClipRole, number>>;
  materials: Record<string, MaterialRole>;
  // pull a slot's surface inwards (m along -normal), against z-fighting
  inset: Record<string, number>;
}

export const ASTRONAUT: RigConfig = {
  height: 1.8,
  upperRoot: "Abdomen",
  bones: {
    body: ["Body", /^body$|pelvis/i],
    hips: ["Hips", /hips/i],
    spine: ["Abdomen", /abdomen|^spine$/i],
    chest: ["Torso", /torso|spine1|spine2/i],
    upperChest: ["Chest", /upperchest|chest|spine3/i],
    neck: ["Neck", /neck/i],
    head: ["Head", /head/i],
    shoulderL: ["ShoulderL", /shoulder.*l/i],
    upperArmL: ["UpperArmL", /upperarm.*l|leftarm/i],
    shoulderR: ["ShoulderR", /shoulder.*r/i],
    upperArmR: ["UpperArmR", /upperarm.*r|rightarm/i],
    handR: ["WristR", /wrist.*r|hand.*r|righthand/i],
    upperLegL: ["UpperLegL", /upperleg.*l|thigh.*l|leftupleg/i],
    lowerLegL: ["LowerLegL", /lowerleg.*l|shin.*l|leftleg/i],
    footL: ["FootL", /foot.*l|leftfoot/i],
    upperLegR: ["UpperLegR", /upperleg.*r|thigh.*r|rightupleg/i],
    lowerLegR: ["LowerLegR", /lowerleg.*r|shin.*r|rightleg/i],
    footR: ["FootR", /foot.*r|rightfoot/i],
  },
  clips: {
    idle: ["Idle_Gun", /idle.*gun|idle(?!.*(hit|death))/i],
    aim: ["Idle_Gun_Pointing", /point|aim/i],
    walkF: ["Walk", /walk(?!.*back)/i],
    runF: ["Run", /^run$|run(?!.*(back|left|right|shoot))/i],
    back: ["Run_Back", /back|backward/i],
    strafeL: ["Run_Left", /strafe.*l|left/i],
    strafeR: ["Run_Right", /strafe.*r|right/i],
    runAim: ["Run_Shoot", /run.*(shoot|gun)/i],
    shoot: ["Gun_Shoot", /shoot|fire/i],
    hit: ["HitRecieve", /hit|recieve|receive|damage/i],
    death: ["Death", /death|die/i],
    win: ["Wave", /victory|cheer|dance|wave/i],
  },
  // measured headless on the loop-closed clips (clipFix.ts): left-foot
  // touchdown (normalised time) and planted-foot speed at 1.8 high
  phaseOffset: { walkF: 0.037, runF: 0.471, back: 0.333, strafeL: 0.0, strafeR: 0.471, runAim: 0.446 },
  nativeSpeed: { walkF: 1.3, runF: 2.74, back: 2.9, strafeL: 2.74, strafeR: 2.74 },
  materials: {
    SciFi_Light_Accent: "plates",
    SciFi_Light: "trim",
    SciFi_Main: "suit",
    SciFi_MainDark: "suit",
    Grey: "visor",
  },
  inset: { Grey: 0.008 },
};

export function findBone(root: Object3D, [name, alias]: [string, RegExp]): Object3D | null {
  const exact = root.getObjectByName(name);
  if (exact) return exact;
  let hit: Object3D | null = null;
  root.traverse((o) => {
    if (!hit && (o as Object3D & { isBone?: boolean }).isBone && alias.test(o.name)) hit = o;
  });
  return hit;
}

export function findClip(clips: AnimationClip[], [name, alias]: [string, RegExp]): AnimationClip | null {
  const short = (c: AnimationClip) => c.name.split("|").pop() ?? c.name;
  return clips.find((c) => short(c) === name) ?? clips.find((c) => alias.test(short(c))) ?? null;
}

import { LevelDataType } from "./types";

export const SCREEN_SIZE = {
  width: 1920,
  height: 1080,
};

export const BACKGROUND_COLOURS = {
  grey: "#656565",
  lightGrey: "#8c8c8c",
  darkerGrey: "#7a7a7a",
  lighterGrey: "#e8eaec",
};

export const GRENADE_LIST = [
  "red",
  "yellow",
  "blue",
  "limegreen",
  "purple",
  "cyan",
];

export const PLAYER_DEFAULT_DATA = {
  x: 0,
  y: 0,
  angle: 0,
  tileType: 0,
  grenade: {
    x: 0,
    y: 0,
    angle: 0,
    speed: 1000,
    dropSpeed: 900,
    tileType: 0,
    visible: false,
  },
  nextGrenade: {
    x: 0,
    y: 0,
    tileType: 0,
  },
};

export const BOMB_SHOOTER_LEVEL_DATA: LevelDataType = {
  x: 10,
  y: 15,
  width: 1600,
  height: 900,
  columns: 15,
  rows: 9,
  rowHeight: 50,
  radius: 20,
  tiles: [],
  initialItemRow: 3,
  addRowItem: "ceiling",
  addNewItemRowCounter: 20,
  isTimerOn: false,
};

export const BOMB_SHOOTER_TILE = {
  x: 0,
  y: 0,
  type: 0,
  removed: false,
  shift: 0,
  velocity: 0,
  alpha: 1,
  processed: false,
};

export const NEIGHBORS_OFFSETS = [
  [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
  ], // Even row tiles
  [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ], // Odd row tiles
];

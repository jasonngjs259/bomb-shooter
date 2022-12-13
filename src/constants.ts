export const GRENADE_LIST = [
  "red",
  "yellow",
  "blue",
  "green",
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

export const KABOOM_LEVEL_DATA = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  columns: 15,
  rows: 14,
  tileWidth: 40,
  tileHeight: 40,
  rowHeight: 34,
  radius: 20,
  tiles: [],
};

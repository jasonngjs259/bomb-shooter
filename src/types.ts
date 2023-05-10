export enum GAME_STATES {
  initial = 0,
  ready = 1,
  shootGrenade = 2,
  removeCluster = 3,
  gameOver = 4,
}

export interface TileType {
  x: number;
  y: number;
  type: number;
  removed: boolean;
  shift: number;
  velocity: number;
  alpha: number;
  processed: boolean;
}

export interface LevelDataType {
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  rowHeight: number;
  radius: number;
  tiles: TileType[][];
  ignoreMatchedShot: boolean;
}

export interface PlayerDataType {
  x: number;
  y: number;
  angle: number;
  tileType: number;
  grenade: {
    x: number;
    y: number;
    angle: number;
    speed: number;
    dropSpeed: number;
    tileType: number;
    visible: boolean;
  };
  nextGrenade: {
    x: number;
    y: number;
    tileType: number;
  };
}

export type Vector2 = {
  x: number;
  y: number;
};

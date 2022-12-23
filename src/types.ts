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
}

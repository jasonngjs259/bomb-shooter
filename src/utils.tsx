import { NEIGBORS_OFFSETS } from "./constants";
import { LevelDataType, TileType } from "./types";

// Get a random int between low and high, inclusive
export const randomRange = (low: number, high: number) => {
  return Math.floor(low + Math.random() * (high - low + 1));
};

// Convert radians to degrees
export const radToDeg = (angle: number) => {
  return angle * (180 / Math.PI);
};

// Convert degrees to radians
export const degToRad = (angle: number) => {
  return angle * (Math.PI / 180);
};

// Check if two circles intersect
export const circleIntersection = (
  x1: number,
  y1: number,
  radius1: number,
  x2: number,
  y2: number,
  radius2: number
) => {
  // Calculate the distance between the centers
  let dx = x1 - x2;
  let dy = y1 - y2;
  let len = Math.sqrt(dx * dx + dy * dy);

  if (len < radius1 + radius2) {
    // Circles intersect
    return true;
  }

  return false;
};

// Find the remaining colors
const findColors = (grenadelist: string[], levelData: LevelDataType) => {
  let foundColors = [];
  let colorTable = [];
  for (let n = 0; n < grenadelist.length; n++) {
    colorTable.push(false);
  }

  // Check all tiles
  for (let i = 0; i < levelData.columns; i++) {
    for (let j = 0; j < levelData.rows; j++) {
      let tile = levelData.tiles[i][j];
      if (tile.type >= 0) {
        if (!colorTable[tile.type]) {
          colorTable[tile.type] = true;
          foundColors.push(tile.type);
        }
      }
    }
  }

  return foundColors;
};

// Get a random existing color
export const getExistingColor = (
  grenadelist: string[],
  levelData: LevelDataType
) => {
  let existingColors = findColors(grenadelist, levelData);

  let grenadeType = 0;
  if (existingColors.length > 0) {
    grenadeType = existingColors[randomRange(0, existingColors.length - 1)];
  }

  return grenadeType;
};

// Get the mouse position
export const getMousePosition = (canvas: HTMLCanvasElement, e: MouseEvent) => {
  let rect = canvas.getBoundingClientRect();
  return {
    x: Math.round(
      ((e.clientX - rect.left) / (rect.right - rect.left)) * canvas.width
    ),
    y: Math.round(
      ((e.clientY - rect.top) / (rect.bottom - rect.top)) * canvas.height
    ),
  };
};

// Get the tile coordinate
export const getTileCoordinate = (
  column: number,
  row: number,
  levelData: LevelDataType,
  rowOffset: number
) => {
  let tileX = levelData.x + column * levelData.tileWidth;

  // X offset for odd or even rows
  if ((row + rowOffset) % 2) {
    tileX += levelData.tileWidth / 2;
  }

  let tileY = levelData.y + row * levelData.rowHeight;

  return { tileX: tileX, tileY: tileY };
};

// Get the closest grid position
export const getGridPosition = (
  x: number,
  y: number,
  levelData: LevelDataType,
  rowOffset: number
) => {
  let gridY = Math.floor((y - levelData.y) / levelData.rowHeight);

  // Check for offset
  let xOffset = 0;
  if ((gridY + rowOffset) % 2) {
    xOffset = levelData.tileWidth / 2;
  }
  let gridX = Math.floor((x - xOffset - levelData.x) / levelData.tileWidth);

  return { x: gridX, y: gridY };
};

// Get the neighbors of the specified tile
export const getNeighbors = (
  tile: TileType,
  rowOffset: number,
  levelData: LevelDataType
) => {
  let tileRow = (tile.y + rowOffset) % 2; // Even or odd row
  let neighbors = [];

  // Get the neighbor offsets for the specified tile
  let n = NEIGBORS_OFFSETS[tileRow];

  // Get the neighbors
  for (let i = 0; i < n.length; i++) {
    // Neighbor coordinate
    let nx = tile.x + n[i][0];
    let ny = tile.y + n[i][1];

    // Make sure the tile is valid
    if (nx >= 0 && nx < levelData.columns && ny >= 0 && ny < levelData.rows) {
      neighbors.push(levelData.tiles[nx][ny]);
    }
  }

  return neighbors;
};

// Reset the processed flags
const resetProcessed = (levelData: LevelDataType) => {
  for (let i = 0; i < levelData.columns; i++) {
    for (let j = 0; j < levelData.rows; j++) {
      levelData.tiles[i][j].processed = false;
    }
  }
};

// Reset the removed flags
export const resetRemoved = (levelData: LevelDataType) => {
  for (let i = 0; i < levelData.columns; i++) {
    for (let j = 0; j < levelData.rows; j++) {
      levelData.tiles[i][j].removed = false;
    }
  }
};

// Find cluster at the specified tile location
export const findCluster = (
  tileX: number,
  tileY: number,
  matchType: boolean,
  reset: boolean,
  skipRemoved: boolean,
  rowOffset: number,
  levelData: LevelDataType
) => {
  // Reset the processed flags
  if (reset) {
    resetProcessed(levelData);
  }

  // Get the target tile. Tile coord must be valid.
  let targetTile = levelData.tiles[tileX][tileY];

  // Initialize the toprocess array with the specified tile
  let toProcess = [targetTile];
  targetTile.processed = true;
  let foundCluster = [];

  while (toProcess.length > 0) {
    // Pop the last element from the array
    let currentTile: TileType | undefined = toProcess.pop();

    // Skip processed and empty tiles
    if (currentTile && currentTile.type === -1) {
      continue;
    }

    // Skip tiles with the removed flag
    if (currentTile && skipRemoved && currentTile.removed) {
      continue;
    }

    // Check if current tile has the right type, if matchtype is true
    if (currentTile && (!matchType || currentTile.type === targetTile.type)) {
      // Add current tile to the cluster
      foundCluster.push(currentTile);

      // Get the neighbors of the current tile
      let neighbors = getNeighbors(currentTile, rowOffset, levelData);

      // Check the type of each neighbor
      for (let i = 0; i < neighbors.length; i++) {
        if (!neighbors[i].processed) {
          // Add the neighbor to the toprocess array
          toProcess.push(neighbors[i]);
          neighbors[i].processed = true;
        }
      }
    }
  }

  // Return the found cluster
  return foundCluster;
};

// Find floating clusters
export const findFloatingClusters = (
  levelData: LevelDataType,
  rowOffset: number
) => {
  // Reset the processed flags
  resetProcessed(levelData);

  let foundClusters = [];

  // Check all tiles
  for (let i = 0; i < levelData.columns; i++) {
    for (let j = 0; j < levelData.rows; j++) {
      let tile = levelData.tiles[i][j];
      if (!tile.processed) {
        // Find all attached tiles
        let foundCluster = findCluster(
          i,
          j,
          false,
          false,
          true,
          rowOffset,
          levelData
        );

        // There must be a tile in the cluster
        if (foundCluster.length <= 0) {
          continue;
        }

        // Check if the cluster is floating
        let floating = true;
        for (let k = 0; k < foundCluster.length; k++) {
          if (foundCluster[k].y === 0) {
            // Tile is attached to the roof
            floating = false;
            break;
          }
        }

        if (floating) {
          // Found a floating cluster
          foundClusters.push(foundCluster);
        }
      }
    }
  }

  console.log(foundClusters);

  return foundClusters;
};

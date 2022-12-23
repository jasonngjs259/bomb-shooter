import { useEffect, useRef, useState } from "react";
import {
  BOMB_SHOOTER_LEVEL_DATA,
  BOMB_SHOOTER_TILE,
  GRENADE_LIST,
  NEIGBORS_OFFSETS,
  PLAYER_DEFAULT_DATA,
} from "./constants";
import { GAME_STATES, LevelDataType, TileType } from "./types";
import {
  circleIntersection,
  degToRad,
  findCluster,
  findFloatingClusters,
  getExistingColor,
  getGridPosition,
  getMousePosition,
  getNeighbors,
  getTileCoordinate,
  radToDeg,
  randomRange,
  resetRemoved,
} from "./utils";

const BombShooter = () => {
  const [gameStart, setGameStart] = useState<boolean>(false);
  const [playerData, setPlayerData] = useState({ ...PLAYER_DEFAULT_DATA });
  const [levelData, setLevelData] = useState<LevelDataType>({
    ...BOMB_SHOOTER_LEVEL_DATA,
  });
  const [counter, setCounter] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rowOffset = useRef<number>(0);
  const cluster = useRef<TileType[]>([]);
  const floatingClusters = useRef<TileType[][]>([]);
  const turnCounter = useRef<number>(0);
  const animationState = useRef<number>(0);
  const lastFrame = useRef<number>(0);
  const fpsTime = useRef<number>(0);
  const frameCount = useRef<number>(0);
  const fps = useRef<number>(0);
  const animationFrame = useRef<number>(0);
  const gameState = useRef<number>(GAME_STATES.initial);

  // Draw a frame around the game
  const drawFrame = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context || !canvas) return;
    // Draw background
    context.fillStyle = "#e8eaec";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Draw header
    context.fillStyle = "#303030";
    context.fillRect(0, 0, canvas.width, 79);
  };

  // Draw the Grenade
  const drawGrenade = (x: number, y: number, index: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (index < 0 || index >= GRENADE_LIST.length || !context) return;

    // Draw the grenade sprite
    context.beginPath();
    context.arc(x + 20, y + 20, 19, 0, 2 * Math.PI);
    context.stroke();
    context.fillStyle = GRENADE_LIST[index];
    context.fill();
  };

  const checkGameOver = () => {
    // Check for game over
    for (let i = 0; i < levelData.columns; i++) {
      // Check if there are grenades in the bottom row
      if (levelData.tiles[i][levelData.rows - 1].type !== -1) {
        // Game over
        nextGrenade();
        gameState.current = GAME_STATES.gameOver;
        // setGameState(GAME_STATES.gameOver);
        return true;
      }
    }

    return false;
  };

  const addGrenades = () => {
    // Move the rows downwards
    for (let i = 0; i < levelData.columns; i++) {
      for (let j = 0; j < levelData.rows - 1; j++) {
        levelData.tiles[i][levelData.rows - 1 - j].type =
          levelData.tiles[i][levelData.rows - 1 - j - 1].type;
      }
    }

    // Add a new row of bubbles at the top
    for (let i = 0; i < levelData.columns; i++) {
      // Add random, existing, colors
      levelData.tiles[i][0].type = getExistingColor(GRENADE_LIST, levelData);
    }
  };

  const nextGrenade = () => {
    // Set the current grenade
    playerData.tileType = playerData.nextGrenade.tileType;
    playerData.grenade.tileType = playerData.nextGrenade.tileType;
    playerData.grenade.x = playerData.x;
    playerData.grenade.y = playerData.y;
    playerData.grenade.visible = true;

    // Get a random type from the existing colors
    let nextColor = getExistingColor(GRENADE_LIST, levelData);

    // Set the next grenade
    playerData.nextGrenade.tileType = nextColor;
  };

  // Snap grenade to the grid
  const snapGrenade = () => {
    // Get the grid position
    const centerX = playerData.grenade.x + levelData.tileWidth / 2;
    const centerY = playerData.grenade.y + levelData.tileHeight / 2;
    let gridPosition = getGridPosition(
      centerX,
      centerY,
      levelData,
      rowOffset.current
    );

    // Make sure the grid position is valid
    if (gridPosition.x < 0) {
      gridPosition.x = 0;
    }

    if (gridPosition.x >= levelData.columns) {
      gridPosition.x = levelData.columns - 1;
    }

    if (gridPosition.y < 0) {
      gridPosition.y = 0;
    }

    if (gridPosition.y >= levelData.rows) {
      gridPosition.y = levelData.rows - 1;
    }

    // Check if the tile is empty
    let addTile = false;
    if (levelData.tiles[gridPosition.x][gridPosition.y].type !== -1) {
      // Tile is not empty, shift the new tile downwards
      for (let newRow = gridPosition.y + 1; newRow < levelData.rows; newRow++) {
        if (levelData.tiles[gridPosition.x][newRow].type === -1) {
          gridPosition.y = newRow;
          addTile = true;
          break;
        }
      }
    } else {
      addTile = true;
    }

    // Add the tile to the grid
    if (addTile) {
      // Hide the player grenade
      playerData.grenade.visible = false;

      // Set the tile
      levelData.tiles[gridPosition.x][gridPosition.y].type =
        playerData.grenade.tileType;

      // Check for game over
      if (checkGameOver()) {
        return;
      }

      // Find clusters
      cluster.current = findCluster(
        gridPosition.x,
        gridPosition.y,
        true,
        true,
        false,
        rowOffset.current,
        levelData
      );

      if (cluster.current.length >= 3) {
        // Remove the cluster
        gameState.current = GAME_STATES.removeCluster;
        // setGameState(GAME_STATES.removeCluster);
        return;
      }
    }

    // No clusters found
    turnCounter.current++;
    if (turnCounter.current >= 5) {
      // Add a row of grenades
      addGrenades();
      turnCounter.current = 0;
      rowOffset.current = (rowOffset.current + 1) % 2;

      if (checkGameOver()) {
        return;
      }
    }

    // Next grenade
    nextGrenade();
    gameState.current = GAME_STATES.ready;
    // setGameState(GAME_STATES.ready);
  };

  // Shoot the grenade
  const shootGrenade = () => {
    // Shoot the grenade in the direction of the mouse
    playerData.grenade.x = playerData.x;
    playerData.grenade.y = playerData.y;
    playerData.grenade.angle = playerData.angle;
    playerData.grenade.tileType = playerData.tileType;

    // Set the gamestate
    gameState.current = GAME_STATES.shootGrenade;
    // setGameState(GAME_STATES.shootGrenade);
  };

  const stateShootGrenade = (dt: number) => {
    // grenade is moving

    // Move the grenade in the direction of the mouse
    playerData.grenade.x +=
      dt *
      playerData.grenade.speed *
      Math.cos(degToRad(playerData.grenade.angle));
    playerData.grenade.y +=
      dt *
      playerData.grenade.speed *
      -1 *
      Math.sin(degToRad(playerData.grenade.angle));

    // Handle left and right collisions with the level
    if (playerData.grenade.x <= levelData.x) {
      // Left edge
      playerData.grenade.angle = 180 - playerData.grenade.angle;
      playerData.grenade.x = levelData.x;
    } else if (
      playerData.grenade.x + levelData.tileWidth >=
      levelData.x + levelData.width
    ) {
      // Right edge
      playerData.grenade.angle = 180 - playerData.grenade.angle;
      playerData.grenade.x =
        levelData.x + levelData.width - levelData.tileWidth;
    }

    // Collisions with the top of the level
    if (playerData.grenade.y <= levelData.y) {
      // Top collision
      playerData.grenade.y = levelData.y;
      snapGrenade();
      return;
    }

    // Collisions with other tiles
    for (let i = 0; i < levelData.columns; i++) {
      for (let j = 0; j < levelData.rows; j++) {
        let tile = levelData.tiles[i][j];

        // Skip empty tiles
        if (tile.type < 0) {
          continue;
        }

        // Check for intersections
        let coord = getTileCoordinate(i, j, levelData, rowOffset.current);
        if (
          circleIntersection(
            playerData.grenade.x + levelData.tileWidth / 2,
            playerData.grenade.y + levelData.tileHeight / 2,
            levelData.radius,
            coord.tileX + levelData.tileWidth / 2,
            coord.tileY + levelData.tileHeight / 2,
            levelData.radius
          )
        ) {
          // Intersection with a level grenade
          snapGrenade();
          return;
        }
      }
    }
  };

  const stateRemoveCluster = (dt: number) => {
    if (animationState.current === 0) {
      resetRemoved(levelData);

      // Mark the tiles as removed
      for (let i = 0; i < cluster.current.length; i++) {
        // Set the removed flag
        cluster.current[i].removed = true;
      }

      // Find floating clusters
      floatingClusters.current = findFloatingClusters(
        levelData,
        rowOffset.current
      );

      if (floatingClusters.current.length > 0) {
        // Setup drop animation
        for (let i = 0; i < floatingClusters.current.length; i++) {
          for (let j = 0; j < floatingClusters.current[i].length; j++) {
            let tile = floatingClusters.current[i][j];
            tile.shift = 0;
            tile.shift = 1;
            tile.velocity = playerData.grenade.dropSpeed;
          }
        }
      }

      animationState.current = 1;
    }

    if (animationState.current === 1) {
      // Pop grenades
      let tilesLeft = false;
      for (let i = 0; i < cluster.current.length; i++) {
        let tile = cluster.current[i];

        if (tile.type >= 0) {
          tilesLeft = true;

          // Alpha animation
          tile.alpha -= dt * 15;
          if (tile.alpha < 0) {
            tile.alpha = 0;
          }

          if (tile.alpha === 0) {
            tile.type = -1;
            tile.alpha = 1;
          }
        }
      }

      // Drop grenades
      for (let i = 0; i < floatingClusters.current.length; i++) {
        for (let j = 0; j < floatingClusters.current[i].length; j++) {
          let tile = floatingClusters.current[i][j];

          if (tile.type >= 0) {
            tilesLeft = true;

            // Accelerate dropped tiles
            tile.velocity += dt * 700;
            tile.shift += dt * tile.velocity;

            // Alpha animation
            tile.alpha -= dt * 8;
            if (tile.alpha < 0) {
              tile.alpha = 0;
            }

            // Check if the grenades are past the bottom of the level
            if (
              tile.alpha === 0 ||
              tile.y * levelData.rowHeight + tile.shift >
                (levelData.rows - 1) * levelData.rowHeight +
                  levelData.tileHeight
            ) {
              tile.type = -1;
              tile.shift = 0;
              tile.alpha = 1;
            }
          }
        }
      }

      if (!tilesLeft) {
        // Next grenade
        nextGrenade();

        // Check for game over
        let tilefound = false;
        for (let i = 0; i < levelData.columns; i++) {
          for (let j = 0; j < levelData.rows; j++) {
            if (levelData.tiles[i][j].type !== -1) {
              tilefound = true;
              break;
            }
          }
        }

        if (tilefound) {
          gameState.current = GAME_STATES.ready;
          // setGameState(GAME_STATES.ready);
        } else {
          // No tiles left, game over
          gameState.current = GAME_STATES.gameOver;
          // setGameState(GAME_STATES.gameOver);
        }
      }
    }
  };

  // On mouse movement
  const onMouseMove = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get the mouse position
    let pos = getMousePosition(canvas, e);

    // Get the mouse angle
    let mouseAngle = radToDeg(
      Math.atan2(
        playerData.y + levelData.tileHeight / 2 - pos.y,
        pos.x - (playerData.x + levelData.tileWidth / 2)
      )
    );

    // Convert range to 0, 360 degrees
    if (mouseAngle < 0) {
      mouseAngle = 180 + (180 + mouseAngle);
    }

    // Restrict angle to 8, 172 degrees
    let lowerBound = 8;
    let upperBound = 172;
    if (mouseAngle > 90 && mouseAngle < 270) {
      // Left
      if (mouseAngle > upperBound) {
        mouseAngle = upperBound;
      }
    } else {
      // Right
      if (mouseAngle < lowerBound || mouseAngle >= 270) {
        mouseAngle = lowerBound;
      }
    }

    // Set the player angle
    playerData.angle = mouseAngle;
  };

  // On mouse button click
  const onMouseDown = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (gameState.current === GAME_STATES.ready) {
      shootGrenade();
    } else if (gameState.current === GAME_STATES.gameOver) {
      newGame();
    }
  };

  const updateFps = (dt: number) => {
    if (fpsTime.current > 0.25) {
      // Calculate fps
      fps.current = Math.round(frameCount.current / fpsTime.current);

      // Reset time and framecount
      fpsTime.current = 0;
      frameCount.current = 0;
    }

    // Increase time and framecount
    fpsTime.current += dt;
    frameCount.current++;
  };

  // Update the game state
  const update = (timeFrame: number) => {
    let dt = (timeFrame - lastFrame.current) / 1000;
    lastFrame.current = timeFrame;

    // Update the fps counter
    updateFps(dt);

    if (gameState.current === GAME_STATES.shootGrenade) {
      // Bubble is moving
      stateShootGrenade(dt);
    } else if (gameState.current === GAME_STATES.removeCluster) {
      // Remove cluster and drop tiles
      stateRemoveCluster(dt);
    }
  };

  // Render tiles
  const renderTiles = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;

    // Top to bottom
    for (let j = 0; j < levelData.rows; j++) {
      for (let i = 0; i < levelData.columns; i++) {
        // Get the tile
        let tile = levelData.tiles[i][j];

        // Get the shift of the tile for animation
        let shift = tile.shift;

        // Calculate the tile coordinates
        let coordinate = getTileCoordinate(i, j, levelData, rowOffset.current);

        // Check if there is a tile present
        if (tile.type >= 0) {
          // Support transparency
          context.save();
          context.globalAlpha = tile.alpha;

          // Draw the tile using the color
          drawGrenade(coordinate.tileX, coordinate.tileY + shift, tile.type);

          context.restore();
        }
      }
    }
  };

  // Render the player tile
  const renderPlayer = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!context) return;

    let centerX = playerData.x + levelData.tileWidth / 2;
    let centerY = playerData.y + levelData.tileHeight / 2;

    // Draw player background circle
    context.fillStyle = "#7a7a7a";
    context.beginPath();
    context.arc(centerX, centerY, levelData.radius + 12, 0, 2 * Math.PI, false);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "#8c8c8c";
    context.stroke();

    // Draw the angle
    context.lineWidth = 2;
    context.strokeStyle = "#0000ff";
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(
      centerX +
        1.5 * levelData.tileWidth * Math.cos(degToRad(playerData.angle)),
      centerY -
        1.5 * levelData.tileHeight * Math.sin(degToRad(playerData.angle))
    );
    context.stroke();

    // Draw the next grenade
    drawGrenade(
      playerData.nextGrenade.x,
      playerData.nextGrenade.y,
      playerData.nextGrenade.tileType
    );

    // Draw the grenade
    if (playerData.grenade.visible) {
      drawGrenade(
        playerData.grenade.x,
        playerData.grenade.y,
        playerData.grenade.tileType
      );
    }
  };

  // Render the game
  const render = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // Add mouse events
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);

    // Draw the frame around the game
    drawFrame();

    let yoffset = levelData.tileHeight / 2;

    // Draw level background
    context.fillStyle = "#8c8c8c";
    context.fillRect(
      levelData.x - 4,
      levelData.y - 4,
      levelData.width + 8,
      levelData.height + 4 - yoffset
    );

    // Render tiles
    renderTiles();

    // Draw level bottom
    context.fillStyle = "#656565";
    context.fillRect(
      levelData.x - 4,
      levelData.y - 4 + levelData.height + 4 - yoffset,
      levelData.width + 8,
      2 * levelData.tileHeight + 3
    );

    // Render player grenade
    renderPlayer();

    animationFrame.current = window.requestAnimationFrame(render);
    update(animationFrame.current);
  };

  // Create a random level
  const createLevel = () => {
    // Create a level with random tiles
    for (let j = 0; j < levelData.rows; j++) {
      let randomTile = randomRange(0, GRENADE_LIST.length - 1);
      let count = 0;
      for (let i = 0; i < levelData.columns; i++) {
        if (count >= 2) {
          // Change the random tile
          let newTile = randomRange(0, GRENADE_LIST.length - 1);

          // Make sure the new tile is different from the previous tile
          if (newTile === randomTile) {
            newTile = (newTile + 1) % GRENADE_LIST.length;
          }
          randomTile = newTile;
          count = 0;
        }
        count++;

        if (j < levelData.rows / 2) {
          levelData.tiles[i][j].type = randomTile;
        } else {
          levelData.tiles[i][j].type = -1;
        }
      }
    }
  };

  // Start a new game
  const newGame = () => {
    // Set the gamestate to ready
    gameState.current = GAME_STATES.ready;
    // setGameState(GAME_STATES.ready);

    // Create the level
    createLevel();

    // Init the next grenade and set the current grenade
    nextGrenade();
    nextGrenade();
  };

  const main = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!gameStart && context && canvas) {
      // Clear the canvas
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the frame
      drawFrame();

      setTimeout(() => {
        setGameStart(true);
      }, 1000);
    }
  };

  // Initialize the game
  const initialGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Initialize the two-dimensional tile array
    for (let i = 0; i < levelData.columns; i++) {
      levelData.tiles[i] = [];
      for (let j = 0; j < levelData.rows; j++) {
        // Define a tile type and a shift parameter for animation

        const tempTile = {
          ...BOMB_SHOOTER_TILE,
          x: i,
          y: j,
          type: 0,
          shift: 0,
        };

        levelData.tiles[i].push(tempTile);
      }
    }

    levelData.width =
      levelData.columns * levelData.tileWidth + levelData.tileWidth / 2;
    levelData.height =
      (levelData.rows - 1) * levelData.rowHeight + levelData.tileHeight;

    // Init the player
    playerData.x = levelData.x + levelData.width / 2 - levelData.tileWidth / 2;
    playerData.y = levelData.y + levelData.height;
    playerData.angle = 90;
    playerData.tileType = 0;
    playerData.nextGrenade.x = playerData.x - 2 * levelData.tileWidth;
    playerData.nextGrenade.y = playerData.y;

    // New game
    newGame();
    main();
  };

  useEffect(() => {
    initialGame();
  }, []);

  useEffect(() => {
    if (gameStart) render();

    return () => window.cancelAnimationFrame(animationFrame.current);
  }, [gameStart]);

  return (
    <div className="canvasContainer">
      <canvas ref={canvasRef} width={628} height={628} />
    </div>
  );
};

export default BombShooter;

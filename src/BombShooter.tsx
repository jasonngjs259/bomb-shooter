import { useEffect, useRef, useState } from "react";
import {
  BOMB_SHOOTER_LEVEL_DATA,
  BOMB_SHOOTER_TILE,
  GRENADE_LIST,
  NEIGBORS_OFFSETS,
  PLAYER_DEFAULT_DATA,
} from "./constants";
import { GAME_STATES, LevelDataType, PlayerDataType, TileType } from "./types";
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

  const levelData = useRef<LevelDataType>({ ...BOMB_SHOOTER_LEVEL_DATA });
  const playerData = useRef<PlayerDataType>({ ...PLAYER_DEFAULT_DATA });
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
  // const fpsDetails = {
  //   fps: 0,
  //   fpsInterval: 0,
  //   startTime: 0,
  //   now: 0,
  //   then: 0,
  //   elapsed: 0,
  // }

  function setGameState(newGameState: number) {
    gameState.current = newGameState;

    animationState.current = 0;
  }

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

  // Draw text that is centered
  const drawCenterText = (
    text: string,
    x: number,
    y: number,
    width: number
  ) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!context) return;
    var textdim = context.measureText(text);
    context.fillText(text, x + (width - textdim.width) / 2, y);
  };

  const checkGameOver = () => {
    // Check for game over
    for (let i = 0; i < levelData.current.columns; i++) {
      // Check if there are grenades in the bottom row
      if (levelData.current.tiles[i][levelData.current.rows - 1].type !== -1) {
        // Game over
        nextGrenade();
        setGameState(GAME_STATES.gameOver);
        // gameState.current = GAME_STATES.gameOver;
        // setGameState(GAME_STATES.gameOver);
        return true;
      }
    }

    return false;
  };

  const addGrenades = () => {
    // Move the rows downwards
    for (let i = 0; i < levelData.current.columns; i++) {
      for (let j = 0; j < levelData.current.rows - 1; j++) {
        levelData.current.tiles[i][levelData.current.rows - 1 - j].type =
          levelData.current.tiles[i][levelData.current.rows - 1 - j - 1].type;
      }
    }

    // Add a new row of bubbles at the top
    for (let i = 0; i < levelData.current.columns; i++) {
      // Add random, existing, colors
      levelData.current.tiles[i][0].type = getExistingColor(
        GRENADE_LIST,
        levelData.current
      );
    }
  };

  const nextGrenade = () => {
    // Set the current grenade
    playerData.current.tileType = playerData.current.nextGrenade.tileType;
    playerData.current.grenade.tileType =
      playerData.current.nextGrenade.tileType;
    playerData.current.grenade.x = playerData.current.x;
    playerData.current.grenade.y = playerData.current.y;
    playerData.current.grenade.visible = true;

    // Get a random type from the existing colors
    let nextColor = getExistingColor(GRENADE_LIST, levelData.current);

    // Set the next grenade
    playerData.current.nextGrenade.tileType = nextColor;
  };

  // Snap grenade to the grid
  const snapGrenade = () => {
    // Get the grid position
    const centerX =
      playerData.current.grenade.x + levelData.current.tileWidth / 2;
    const centerY =
      playerData.current.grenade.y + levelData.current.tileHeight / 2;
    let gridPosition = getGridPosition(
      centerX,
      centerY,
      levelData.current,
      rowOffset.current
    );

    // Make sure the grid position is valid
    if (gridPosition.x < 0) {
      gridPosition.x = 0;
    }

    if (gridPosition.x >= levelData.current.columns) {
      gridPosition.x = levelData.current.columns - 1;
    }

    if (gridPosition.y < 0) {
      gridPosition.y = 0;
    }

    if (gridPosition.y >= levelData.current.rows) {
      gridPosition.y = levelData.current.rows - 1;
    }

    // Check if the tile is empty
    let addTile = false;
    if (levelData.current.tiles[gridPosition.x][gridPosition.y].type !== -1) {
      // Tile is not empty, shift the new tile downwards
      for (
        let newRow = gridPosition.y + 1;
        newRow < levelData.current.rows;
        newRow++
      ) {
        if (levelData.current.tiles[gridPosition.x][newRow].type === -1) {
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
      playerData.current.grenade.visible = false;

      // Set the tile
      levelData.current.tiles[gridPosition.x][gridPosition.y].type =
        playerData.current.grenade.tileType;

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
        levelData.current
      );

      if (cluster.current.length >= 3) {
        // Remove the cluster
        setGameState(GAME_STATES.removeCluster);
        // gameState.current = GAME_STATES.removeCluster;
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
    setGameState(GAME_STATES.ready);
    // gameState.current = GAME_STATES.ready;
    // setGameState(GAME_STATES.ready);
  };

  // Shoot the grenade
  const shootGrenade = () => {
    // Shoot the grenade in the direction of the mouse
    playerData.current.grenade.x = playerData.current.x;
    playerData.current.grenade.y = playerData.current.y;
    playerData.current.grenade.angle = playerData.current.angle;
    playerData.current.grenade.tileType = playerData.current.tileType;

    // Set the gamestate
    setGameState(GAME_STATES.shootGrenade);
    // gameState.current = GAME_STATES.shootGrenade;
    // setGameState(GAME_STATES.shootGrenade);
  };

  const stateShootGrenade = (dt: number) => {
    // grenade is moving

    // Move the grenade in the direction of the mouse
    playerData.current.grenade.x +=
      dt *
      playerData.current.grenade.speed *
      Math.cos(degToRad(playerData.current.grenade.angle));
    playerData.current.grenade.y +=
      dt *
      playerData.current.grenade.speed *
      -1 *
      Math.sin(degToRad(playerData.current.grenade.angle));

    // Handle left and right collisions with the level
    if (playerData.current.grenade.x <= levelData.current.x) {
      // Left edge
      playerData.current.grenade.angle = 180 - playerData.current.grenade.angle;
      playerData.current.grenade.x = levelData.current.x;
    } else if (
      playerData.current.grenade.x + levelData.current.tileWidth >=
      levelData.current.x + levelData.current.width
    ) {
      // Right edge
      playerData.current.grenade.angle = 180 - playerData.current.grenade.angle;
      playerData.current.grenade.x =
        levelData.current.x +
        levelData.current.width -
        levelData.current.tileWidth;
    }

    // Collisions with the top of the level
    if (playerData.current.grenade.y <= levelData.current.y) {
      // Top collision
      playerData.current.grenade.y = levelData.current.y;
      snapGrenade();
      return;
    }

    // Collisions with other tiles
    for (let i = 0; i < levelData.current.columns; i++) {
      for (let j = 0; j < levelData.current.rows; j++) {
        let tile = levelData.current.tiles[i][j];

        // Skip empty tiles
        if (tile.type < 0) {
          continue;
        }

        // Check for intersections
        let coord = getTileCoordinate(
          i,
          j,
          levelData.current,
          rowOffset.current
        );
        if (
          circleIntersection(
            playerData.current.grenade.x + levelData.current.tileWidth / 2,
            playerData.current.grenade.y + levelData.current.tileHeight / 2,
            levelData.current.radius,
            coord.tileX + levelData.current.tileWidth / 2,
            coord.tileY + levelData.current.tileHeight / 2,
            levelData.current.radius
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
    console.log(animationState.current);
    if (animationState.current === 0) {
      resetRemoved(levelData.current);

      // Mark the tiles as removed
      for (let i = 0; i < cluster.current.length; i++) {
        console.log(true);
        // Set the removed flag
        cluster.current[i].removed = true;
      }

      // Find floating clusters
      floatingClusters.current = findFloatingClusters(
        levelData.current,
        rowOffset.current
      );

      if (floatingClusters.current.length > 0) {
        // Setup drop animation
        for (let i = 0; i < floatingClusters.current.length; i++) {
          for (let j = 0; j < floatingClusters.current[i].length; j++) {
            let tile = floatingClusters.current[i][j];
            tile.shift = 0;
            tile.shift = 1;
            tile.velocity = playerData.current.grenade.dropSpeed;
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
              tile.y * levelData.current.rowHeight + tile.shift >
                (levelData.current.rows - 1) * levelData.current.rowHeight +
                  levelData.current.tileHeight
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
        let tileFound = false;
        for (let i = 0; i < levelData.current.columns; i++) {
          for (let j = 0; j < levelData.current.rows; j++) {
            if (levelData.current.tiles[i][j].type !== -1) {
              tileFound = true;
              break;
            }
          }
        }

        if (tileFound) {
          setGameState(GAME_STATES.ready);
          // gameState.current = GAME_STATES.ready;
          // setGameState(GAME_STATES.ready);
        } else {
          // No tiles left, game over
          setGameState(GAME_STATES.gameOver);
          // gameState.current = GAME_STATES.gameOver;
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
        playerData.current.y + levelData.current.tileHeight / 2 - pos.y,
        pos.x - (playerData.current.x + levelData.current.tileWidth / 2)
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
    playerData.current.angle = mouseAngle;
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
      console.log(gameState.current);
      stateRemoveCluster(dt);
    }
  };

  // Render tiles
  const renderTiles = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;

    // Top to bottom
    for (let j = 0; j < levelData.current.rows; j++) {
      for (let i = 0; i < levelData.current.columns; i++) {
        // Get the tile
        let tile = levelData.current.tiles[i][j];

        // Get the shift of the tile for animation
        let shift = tile.shift;

        // Calculate the tile coordinates
        let coordinate = getTileCoordinate(
          i,
          j,
          levelData.current,
          rowOffset.current
        );

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

    let centerX = playerData.current.x + levelData.current.tileWidth / 2;
    let centerY = playerData.current.y + levelData.current.tileHeight / 2;

    // Draw player background circle
    context.fillStyle = "#7a7a7a";
    context.beginPath();
    context.arc(
      centerX,
      centerY,
      levelData.current.radius + 12,
      0,
      2 * Math.PI,
      false
    );
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
        1.5 *
          levelData.current.tileWidth *
          Math.cos(degToRad(playerData.current.angle)),
      centerY -
        1.5 *
          levelData.current.tileHeight *
          Math.sin(degToRad(playerData.current.angle))
    );
    context.stroke();

    // Draw the next grenade
    drawGrenade(
      playerData.current.nextGrenade.x,
      playerData.current.nextGrenade.y,
      playerData.current.nextGrenade.tileType
    );

    // Draw the grenade
    if (playerData.current.grenade.visible) {
      drawGrenade(
        playerData.current.grenade.x,
        playerData.current.grenade.y,
        playerData.current.grenade.tileType
      );
    }
  };

  // Render the game
  const render = (fps: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // Add mouse events
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);

    // Draw the frame around the game
    drawFrame();

    let yoffset = levelData.current.tileHeight / 2;

    // Draw level background
    context.fillStyle = "#8c8c8c";
    context.fillRect(
      levelData.current.x - 4,
      levelData.current.y - 4,
      levelData.current.width + 8,
      levelData.current.height + 4 - yoffset
    );

    // Render tiles
    renderTiles();

    // Draw level bottom
    context.fillStyle = "#656565";
    context.fillRect(
      levelData.current.x - 4,
      levelData.current.y - 4 + levelData.current.height + 4 - yoffset,
      levelData.current.width + 8,
      2 * levelData.current.tileHeight + 3
    );

    // Render player grenade
    renderPlayer();

    // Game Over overlay
    if (gameState.current == GAME_STATES.gameOver) {
      context.fillStyle = "rgba(0, 0, 0, 0.8)";
      context.fillRect(
        levelData.current.x - 4,
        levelData.current.y - 4,
        levelData.current.width + 8,
        levelData.current.height +
          2 * levelData.current.tileHeight +
          8 -
          yoffset
      );

      context.fillStyle = "#ffffff";
      context.font = "24px Verdana";
      drawCenterText(
        "Game Over!",
        levelData.current.x,
        levelData.current.y + levelData.current.height / 2 + 10,
        levelData.current.width
      );
      drawCenterText(
        "Click to start",
        levelData.current.x,
        levelData.current.y + levelData.current.height / 2 + 40,
        levelData.current.width
      );
    }

    update(fps);
    animationFrame.current = window.requestAnimationFrame(render);
  };

  // Create a random level
  const createLevel = () => {
    // Create a level with random tiles
    for (let j = 0; j < levelData.current.rows; j++) {
      let randomTile = randomRange(0, GRENADE_LIST.length - 1);
      let count = 0;
      for (let i = 0; i < levelData.current.columns; i++) {
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

        if (j < levelData.current.rows / 2) {
          levelData.current.tiles[i][j].type = randomTile;
        } else {
          levelData.current.tiles[i][j].type = -1;
        }
      }
    }
  };

  // Start a new game
  const newGame = () => {
    // Set the gamestate to ready
    setGameState(GAME_STATES.ready);
    // gameState.current = GAME_STATES.ready;
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
    for (let i = 0; i < levelData.current.columns; i++) {
      levelData.current.tiles[i] = [];
      for (let j = 0; j < levelData.current.rows; j++) {
        // Define a tile type and a shift parameter for animation

        const tempTile = {
          ...BOMB_SHOOTER_TILE,
          x: i,
          y: j,
          type: 0,
          shift: 0,
        };

        levelData.current.tiles[i].push(tempTile);
      }
    }

    levelData.current.width =
      levelData.current.columns * levelData.current.tileWidth +
      levelData.current.tileWidth / 2;
    levelData.current.height =
      (levelData.current.rows - 1) * levelData.current.rowHeight +
      levelData.current.tileHeight;

    // Init the player
    playerData.current.x =
      levelData.current.x +
      levelData.current.width / 2 -
      levelData.current.tileWidth / 2;
    playerData.current.y = levelData.current.y + levelData.current.height;
    playerData.current.angle = 90;
    playerData.current.tileType = 0;
    playerData.current.nextGrenade.x =
      playerData.current.x - 2 * levelData.current.tileWidth;
    playerData.current.nextGrenade.y = playerData.current.y;

    // New game
    newGame();
    main();
  };

  useEffect(() => {
    initialGame();
  }, []);

  useEffect(() => {
    if (gameStart) render(60);

    return () => window.cancelAnimationFrame(animationFrame.current);
  }, [gameStart]);

  // useEffect(() => {
  //   animationState.current = 0;
  // }, [gameState.current]);

  return (
    <div className="canvasContainer">
      <canvas ref={canvasRef} width={628} height={628} />
    </div>
  );
};

export default BombShooter;

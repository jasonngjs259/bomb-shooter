import { useEffect, useRef, useState } from "react";
import {
  BOMB_SHOOTER_LEVEL_DATA,
  BOMB_SHOOTER_TILE,
  GRENADE_LIST,
  PLAYER_DEFAULT_DATA,
} from "./constants";
import { GAME_STATES } from "./types";

const BombShooter = () => {
  const [gameState, setGameState] = useState<number>(GAME_STATES.initial);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // const canvas = canvasRef.current;
  // const context = canvas?.getContext("2d");

  // Timing and frames per second
  let lastframe = 0;
  let fpstime = 0;
  let framecount = 0;
  let fps = 0;

  let initialized = false;

  let rowoffset = 0;

  let turncounter = 0;

  const updateFps = (dt: number) => {
    if (fpstime > 0.25) {
      // Calculate fps
      fps = Math.round(framecount / fpstime);

      // Reset time and framecount
      fpstime = 0;
      framecount = 0;
    }

    // Increase time and framecount
    fpstime += dt;
    framecount++;
  };

  const update = (tframe: number) => {
    let dt = (tframe - lastframe) / 1000;
    lastframe = tframe;

    // Update the fps counter
    updateFps(dt);
  };

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

    // // Display fps
    // context.fillStyle = "#ffffff";
    // context.font = "12px Verdana";
    // context.fillText("Fps: " + fps, 13, 57);
  };

  // Draw the bubble
  const drawBubble = (x: number, y: number, index: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (index < 0 || index >= GRENADE_LIST.length || !context) return;

    // Draw the bubble sprite
    context.beginPath();
    context.arc(x + 20, y + 20, 19, 0, 2 * Math.PI);
    context.stroke();
    context.fillStyle = GRENADE_LIST[index];
    context.fill();

    // context.drawImage(
    //   bubbleimage,
    //   index * 40,
    //   0,
    //   40,
    //   40,
    //   x,
    //   y,
    //   level.tilewidth,
    //   level.tileheight
    // );
  };

  // Get the tile coordinate
  const getTileCoordinate = (column: number, row: number) => {
    let tilex =
      BOMB_SHOOTER_LEVEL_DATA.x + column * BOMB_SHOOTER_LEVEL_DATA.tileWidth;

    // X offset for odd or even rows
    if ((row + rowoffset) % 2) {
      tilex += BOMB_SHOOTER_LEVEL_DATA.tileWidth / 2;
    }

    let tiley =
      BOMB_SHOOTER_LEVEL_DATA.y + row * BOMB_SHOOTER_LEVEL_DATA.rowHeight;

    // console.log(tilex, tiley);

    return { tilex: tilex, tiley: tiley };
  };

  // Render tiles
  const renderTiles = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;

    // Top to bottom
    for (let j = 0; j < BOMB_SHOOTER_LEVEL_DATA.rows; j++) {
      for (let i = 0; i < BOMB_SHOOTER_LEVEL_DATA.columns; i++) {
        // Get the tile
        let tile = BOMB_SHOOTER_LEVEL_DATA.tiles[i][j];

        // Get the shift of the tile for animation
        let shift = tile.shift;

        // Calculate the tile coordinates
        let coord = getTileCoordinate(i, j);

        // Check if there is a tile present
        if (tile.type >= 0) {
          // Support transparency
          context.save();
          context.globalAlpha = tile.alpha;

          // Draw the tile using the color
          drawBubble(coord.tilex, coord.tiley + shift, tile.type);

          context.restore();
        }
      }
    }
  };

  // Render the game
  const render = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;

    // Draw the frame around the game
    drawFrame();

    let yoffset = BOMB_SHOOTER_LEVEL_DATA.tileHeight / 2;

    // Draw level background
    context.fillStyle = "#8c8c8c";
    context.fillRect(
      BOMB_SHOOTER_LEVEL_DATA.x - 4,
      BOMB_SHOOTER_LEVEL_DATA.y - 4,
      BOMB_SHOOTER_LEVEL_DATA.width + 8,
      BOMB_SHOOTER_LEVEL_DATA.height + 4 - yoffset
    );

    // Render tiles
    renderTiles();

    // Draw level bottom
    context.fillStyle = "#656565";
    context.fillRect(
      BOMB_SHOOTER_LEVEL_DATA.x - 4,
      BOMB_SHOOTER_LEVEL_DATA.y -
        4 +
        BOMB_SHOOTER_LEVEL_DATA.height +
        4 -
        yoffset,
      BOMB_SHOOTER_LEVEL_DATA.width + 8,
      2 * BOMB_SHOOTER_LEVEL_DATA.tileHeight + 3
    );

    // Draw score
    // context.fillStyle = "#ffffff";
    // context.font = "18px Verdana";
    // let scorex =
    //   BOMB_SHOOTER_LEVEL_DATA.x + BOMB_SHOOTER_LEVEL_DATA.width - 150;
    // let scorey =
    //   BOMB_SHOOTER_LEVEL_DATA.y +
    //   BOMB_SHOOTER_LEVEL_DATA.height +
    //   BOMB_SHOOTER_LEVEL_DATA.tileHeight -
    //   yoffset -
    //   8;
    // drawCenterText("Score:", scorex, scorey, 150);
    // context.font = "24px Verdana";
    // drawCenterText(score, scorex, scorey + 30, 150);

    // Render player bubble
    // renderPlayer();

    // Game Over overlay
  };

  const main = (tframe: number) => {
    // Request animation frames
    window.requestAnimationFrame(main);

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!initialized && context && canvas) {
      // Preloader

      // Clear the canvas
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the frame
      drawFrame();

      setTimeout(function () {
        initialized = true;
      }, 1000);

      // Draw a progress bar
      // let loadpercentage = loadcount / loadtotal;
      // context.strokeStyle = "#ff8080";
      // context.lineWidth = 3;
      // context.strokeRect(18.5, 0.5 + canvas.height - 51, canvas.width - 37, 32);
      // context.fillStyle = "#ff8080";
      // context.fillRect(
      //   18.5,
      //   0.5 + canvas.height - 51,
      //   loadpercentage * (canvas.width - 37),
      //   32
      // );

      // // Draw the progress text
      // let loadtext = "Loaded " + loadcount + "/" + loadtotal + " images";
      // context.fillStyle = "#000000";
      // context.font = "16px Verdana";
      // context.fillText(loadtext, 18, 0.5 + canvas.height - 63);

      // if (preloaded) {
      //   // Add a delay for demonstration purposes
      //   setTimeout(function () {
      //     initialized = true;
      //   }, 1000);
      // }
    } else {
      // Update and render the game
      update(tframe);
      render();
    }
  };

  // Get a random int between low and high, inclusive
  function randRange(low: number, high: number) {
    return Math.floor(low + Math.random() * (high - low + 1));
  }

  // Create a random level
  const createLevel = () => {
    // Create a level with random tiles
    for (var j = 0; j < BOMB_SHOOTER_LEVEL_DATA.rows; j++) {
      var randomtile = randRange(0, GRENADE_LIST.length - 1);
      var count = 0;
      for (var i = 0; i < BOMB_SHOOTER_LEVEL_DATA.columns; i++) {
        if (count >= 2) {
          // Change the random tile
          var newtile = randRange(0, GRENADE_LIST.length - 1);

          // Make sure the new tile is different from the previous tile
          if (newtile === randomtile) {
            newtile = (newtile + 1) % GRENADE_LIST.length;
          }
          randomtile = newtile;
          count = 0;
        }
        count++;

        if (j < BOMB_SHOOTER_LEVEL_DATA.rows / 2) {
          BOMB_SHOOTER_LEVEL_DATA.tiles[i][j].type = randomtile;
        } else {
          BOMB_SHOOTER_LEVEL_DATA.tiles[i][j].type = -1;
        }
      }
    }

    // console.log(BOMB_SHOOTER_LEVEL_DATA.tiles);
  };

  // Create a random bubble for the player

  // Find the remaining colors
  const findColors = () => {
    let foundcolors = [];
    let colortable = [];
    for (var n = 0; n < GRENADE_LIST.length; n++) {
      colortable.push(false);
    }

    // Check all tiles
    for (let i = 0; i < BOMB_SHOOTER_LEVEL_DATA.columns; i++) {
      for (var j = 0; j < BOMB_SHOOTER_LEVEL_DATA.rows; j++) {
        var tile = BOMB_SHOOTER_LEVEL_DATA.tiles[i][j];
        if (tile.type >= 0) {
          if (!colortable[tile.type]) {
            colortable[tile.type] = true;
            foundcolors.push(tile.type);
          }
        }
      }
    }

    return foundcolors;
  };

  // Get a random existing color
  const getExistingColor = () => {
    let existingcolors = findColors();

    var bubbletype = 0;
    if (existingcolors.length > 0) {
      bubbletype = existingcolors[randRange(0, existingcolors.length - 1)];
    }

    return bubbletype;
  };

  const nextBubble = () => {
    // Set the current bubble
    PLAYER_DEFAULT_DATA.tileType = PLAYER_DEFAULT_DATA.nextGrenade.tileType;
    PLAYER_DEFAULT_DATA.grenade.tileType =
      PLAYER_DEFAULT_DATA.nextGrenade.tileType;
    PLAYER_DEFAULT_DATA.grenade.x = PLAYER_DEFAULT_DATA.x;
    PLAYER_DEFAULT_DATA.grenade.y = PLAYER_DEFAULT_DATA.y;
    PLAYER_DEFAULT_DATA.grenade.visible = true;

    // Get a random type from the existing colors
    var nextcolor = getExistingColor();

    // Set the next bubble
    PLAYER_DEFAULT_DATA.nextGrenade.tileType = nextcolor;
  };

  // Start a new game
  const newGame = () => {
    // Reset score
    // score = 0;

    turncounter = 0;
    rowoffset = 0;

    // Set the gamestate to ready
    setGameState(GAME_STATES.ready);

    // Create the level
    createLevel();

    // Init the next bubble and set the current bubble
    nextBubble();
    nextBubble();
  };

  // Initialize the game
  const init = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Add mouse events
    // canvas.addEventListener("mousemove", onMouseMove);
    // canvas.addEventListener("mousedown", onMouseDown);

    // Initialize the two-dimensional tile array
    for (let i = 0; i < BOMB_SHOOTER_LEVEL_DATA.columns; i++) {
      BOMB_SHOOTER_LEVEL_DATA.tiles[i] = [];
      for (let j = 0; j < BOMB_SHOOTER_LEVEL_DATA.rows; j++) {
        // Define a tile type and a shift parameter for animation

        const tempTile = { ...BOMB_SHOOTER_TILE };
        tempTile.x = i;
        tempTile.y = j;
        tempTile.type = 0;
        tempTile.shift = 0;

        BOMB_SHOOTER_LEVEL_DATA.tiles[i].push(tempTile);
        // console.log(BOMB_SHOOTER_LEVEL_DATA.tiles);
      }
    }

    BOMB_SHOOTER_LEVEL_DATA.width =
      BOMB_SHOOTER_LEVEL_DATA.columns * BOMB_SHOOTER_LEVEL_DATA.tileWidth +
      BOMB_SHOOTER_LEVEL_DATA.tileWidth / 2;
    BOMB_SHOOTER_LEVEL_DATA.height =
      (BOMB_SHOOTER_LEVEL_DATA.rows - 1) * BOMB_SHOOTER_LEVEL_DATA.rowHeight +
      BOMB_SHOOTER_LEVEL_DATA.tileHeight;

    // New game
    newGame();

    // Enter main loop
    main(0);
  };

  // console.log(BOMB_SHOOTER_LEVEL_DATA);

  useEffect(() => {
    init();
  }, []);

  return (
    <div>
      <canvas ref={canvasRef} width={628} height={628} />
    </div>
  );
};

export default BombShooter;

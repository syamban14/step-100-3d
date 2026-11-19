(function (root) {
  'use strict';

  const TILE_SIZE = 2.2;
  const TILE_GAP = 0.14;
  const STEP_PITCH = TILE_SIZE + TILE_GAP;
  const ROW_HEIGHT = 0.45;

  // 8 Tangga (bawah -> atas), dipastikan tidak bertabrakan dengan ular/mystery
  const LADDERS = {
    4: 25,
    13: 46,
    33: 49,
    42: 63,
    50: 69,
    62: 81,
    74: 92,
    84: 97
  };

  // 8 Ular (kepala -> ekor), dipastikan tidak bertabrakan dengan tangga/mystery
  // Di mode Gunung terbagi menjadi 4 Sungai Jeram & 4 Longsoran Tebing
  const STREAMS = {
    27: 5,
    40: 3,
    66: 45,
    89: 53
  };

  const LANDSLIDES = {
    43: 18,
    54: 31,
    76: 58,
    99: 41
  };

  const SNAKES = {
    ...STREAMS,
    ...LANDSLIDES
  };

  // 10 Petak Kejutan (Mystery Tiles) bebas bentrok
  const MYSTERY_TILES = [8, 19, 29, 36, 48, 57, 68, 79, 86, 94];

  const MYSTERY_EFFECTS = ['SHIELD', 'BOOST', 'MAGNET', 'TRAP'];

  const CHARACTERS = [
    {
      id: 'explorer',
      name: 'Explorer',
      color: '#ff5e57',
      accent: '#ffd32a',
      badge: '🧭',
      desc: 'Topi Petualang Merah Koral'
    },
    {
      id: 'knight',
      name: 'Knight',
      color: '#1e90ff',
      accent: '#dfe4ea',
      badge: '🛡️',
      desc: 'Helm Ksatria Biru Samudra'
    },
    {
      id: 'mecha',
      name: 'Mecha',
      color: '#ffa502',
      accent: '#2f3542',
      badge: '🤖',
      desc: 'Robot Antena Kuning Emas'
    },
    {
      id: 'neko',
      name: 'Neko',
      color: '#9b59b6',
      accent: '#ff9ff3',
      badge: '🐱',
      desc: 'Kucing Telinga Ungu'
    }
  ];

  const EMOTES = [
    { id: 'cheer', emoji: '🎉', label: 'Mantap!' },
    { id: 'laugh', emoji: '😂', label: 'Haha!' },
    { id: 'shock', emoji: '😱', label: 'Waduh!' },
    { id: 'cool', emoji: '😎', label: 'Santai' },
    { id: 'fire', emoji: '🔥', label: 'Gas!' },
    { id: 'cry', emoji: '😭', label: 'Ampun!' }
  ];

  function tileToGrid(tile) {
    if (tile <= 0) {
      return { tile: 0, row: 0, col: -1 };
    }
    const clamped = Math.max(1, Math.min(100, tile));
    const row = Math.floor((clamped - 1) / 10);
    const colInRow = (clamped - 1) % 10;
    const col = row % 2 === 0 ? colInRow : 9 - colInRow;
    return { tile: clamped, row, col };
  }

  function tileToClassicWorld(tile) {
    if (tile <= 0) {
      return {
        x: (-4.5 - 1.25) * STEP_PITCH,
        y: -0.05,
        z: 4.5 * STEP_PITCH
      };
    }
    const { row, col } = tileToGrid(tile);
    return {
      x: (col - 4.5) * STEP_PITCH,
      y: row * ROW_HEIGHT,
      z: (4.5 - row) * STEP_PITCH
    };
  }

  function tileToMountainWorld(tile) {
    if (tile <= 0) {
      return {
        x: -11.8,
        y: 0.49,
        z: 12.8
      };
    }
    const clamped = Math.max(1, Math.min(100, tile));
    const row = Math.floor((clamped - 1) / 10);
    const colInRow = (clamped - 1) % 10;
    const col = row % 2 === 0 ? colInRow : 9 - colInRow;

    const nx = (col - 4.5) / 4.5;
    const halfW = 10.2 - row * 0.62;
    const bx = nx * halfW;

    const meanderY = 0.45 * Math.sin(nx * Math.PI * 1.5 + row * 1.1);
    const yBase = -10.8 + row * 1.92;
    const bulge = (1.0 - nx * nx) * (1.85 - row * 0.13);
    const by = yBase - bulge + meanderY;

    const rowProgress = colInRow / 9.0;
    const bz = 0.65 + (row + rowProgress * 0.85) * 0.92;

    return {
      x: bx,
      y: bz + 0.08,
      z: -by
    };
  }

  function tileToWorld(tile, boardStyle = 'classic') {
    return boardStyle === 'mountain' ? tileToMountainWorld(tile) : tileToClassicWorld(tile);
  }

  function getMountainStepWaypoints(fromTile, toTile) {
    const pFrom = tileToMountainWorld(fromTile);
    const pTo = tileToMountainWorld(toTile);
    if (fromTile <= 0 || toTile <= 0) {
      return [pFrom, pTo];
    }
    const rowFrom = Math.floor((fromTile - 1) / 10);
    const rowTo = Math.floor((toTile - 1) / 10);
    if (rowFrom !== rowTo && Math.abs(toTile - fromTile) === 1) {
      const outDir = pTo.x >= 0 ? 1.0 : -1.0;
      const mid = {
        x: (pFrom.x + pTo.x) * 0.5 + outDir * 1.15,
        y: (pFrom.y + pTo.y) * 0.5,
        z: (pFrom.z + pTo.z) * 0.5 - 0.15
      };
      return [pFrom, mid, pTo];
    }
    return [pFrom, pTo];
  }

  function rollDiceValues(diceCount, rngFn) {
    const rand = typeof rngFn === 'function' ? rngFn : Math.random;
    const count = diceCount === 2 ? 2 : 1;
    const values = [];
    for (let i = 0; i < count; i++) {
      values.push(Math.floor(rand() * 6) + 1);
    }
    return values;
  }

  function buildStepPath(fromTile, delta) {
    const path = [];
    let curr = fromTile;
    if (delta > 0) {
      let dir = 1;
      for (let i = 0; i < delta; i++) {
        if (curr >= 100) dir = -1;
        curr += dir;
        path.push(curr);
      }
    } else if (delta < 0) {
      for (let i = 0; i < Math.abs(delta); i++) {
        if (curr > 1) curr -= 1;
        path.push(curr);
      }
    }
    return { path, endTile: curr };
  }

  function resolveTurn(playerState, diceValues, settings, rngFn) {
    const rand = typeof rngFn === 'function' ? rngFn : Math.random;
    const mysteryEnabled = settings ? settings.mysteryTiles !== false : true;

    const startTile = playerState.tile || 0;
    let shield = Boolean(playerState.shield);
    const consecutiveBonus = playerState.consecutiveBonus || 0;

    const totalDice = diceValues.reduce((acc, v) => acc + v, 0);
    const steps = [];

    // 1. Pergerakan utama (dengan bounce-back di petak 100)
    const bounced = startTile + totalDice > 100;
    const walkRes = buildStepPath(startTile, totalDice);
    let curr = walkRes.endTile;

    steps.push({
      type: 'walk',
      from: startTile,
      to: curr,
      path: walkRes.path,
      bounced
    });

    // 2. Cek apakah mendarat tepat di petak 100
    if (curr !== 100) {
      // 3. Cek Mystery Tile jika aktif
      if (mysteryEnabled && MYSTERY_TILES.includes(curr)) {
        const effectIdx = Math.floor(rand() * MYSTERY_EFFECTS.length);
        const effect = MYSTERY_EFFECTS[effectIdx];
        const mysteryTile = curr;

        if (effect === 'SHIELD') {
          shield = true;
          steps.push({
            type: 'mystery',
            effect: 'SHIELD',
            tile: mysteryTile,
            to: curr,
            path: [],
            title: 'Tameng Anti-Ular',
            desc: 'Melindungi 1x dari gigitan ular berikutnya!'
          });
        } else if (effect === 'BOOST') {
          const boostRes = buildStepPath(curr, 3);
          curr = boostRes.endTile;
          steps.push({
            type: 'mystery',
            effect: 'BOOST',
            tile: mysteryTile,
            to: curr,
            path: boostRes.path,
            title: 'Dorongan Roket +3',
            desc: `Meluncur maju 3 petak ke #${curr}!`
          });
        } else if (effect === 'MAGNET') {
          const ladderStarts = Object.keys(LADDERS)
            .map(Number)
            .filter((k) => k > curr && k - curr <= 8)
            .sort((a, b) => a - b);
          const delta = ladderStarts.length > 0 ? ladderStarts[0] - curr : 2;
          const magRes = buildStepPath(curr, delta);
          curr = magRes.endTile;
          steps.push({
            type: 'mystery',
            effect: 'MAGNET',
            tile: mysteryTile,
            to: curr,
            path: magRes.path,
            title: 'Magnet Tangga',
            desc:
              ladderStarts.length > 0
                ? `Tertarik ke kaki tangga di petak #${curr}!`
                : `Dorongan magnet maju 2 petak ke #${curr}!`
          });
        } else {
          const trapRes = buildStepPath(curr, -2);
          curr = trapRes.endTile;
          steps.push({
            type: 'mystery',
            effect: 'TRAP',
            tile: mysteryTile,
            to: curr,
            path: trapRes.path,
            title: 'Jebakan Pasir -2',
            desc: `Terpeleset mundur ke petak #${curr}!`
          });
        }
      }

      // 4. Cek Tangga atau Ular pada petak pendaratan (setelah mystery)
      if (curr !== 100) {
        if (LADDERS[curr]) {
          const dest = LADDERS[curr];
          steps.push({
            type: 'ladder',
            from: curr,
            to: dest
          });
          curr = dest;
        } else if (SNAKES[curr]) {
          const dest = SNAKES[curr];
          if (shield) {
            shield = false;
            steps.push({
              type: 'shield_saved',
              tile: curr,
              avoidedTo: dest
            });
          } else {
            steps.push({
              type: 'snake',
              hazardKind: STREAMS[curr] ? 'stream' : 'landslide',
              from: curr,
              to: dest
            });
            curr = dest;
          }
        }
      }
    }

    const won = curr === 100;
    const isBonusTrigger =
      diceValues.length === 1
        ? diceValues[0] === 6
        : diceValues[0] === diceValues[1] || diceValues[0] === 6 || diceValues[1] === 6;

    const extraTurn = !won && isBonusTrigger && consecutiveBonus < 3;
    const nextConsecutiveBonus = extraTurn ? consecutiveBonus + 1 : 0;

    return {
      diceValues,
      totalDice,
      startTile,
      endTile: curr,
      shieldAfter: shield,
      steps,
      won,
      extraTurn,
      nextConsecutiveBonus,
      bonusLimitReached: !won && isBonusTrigger && consecutiveBonus >= 3
    };
  }

  const BoardConfig = {
    TILE_SIZE,
    TILE_GAP,
    STEP_PITCH,
    ROW_HEIGHT,
    LADDERS,
    STREAMS,
    LANDSLIDES,
    SNAKES,
    MYSTERY_TILES,
    MYSTERY_EFFECTS,
    CHARACTERS,
    EMOTES,
    tileToGrid,
    tileToClassicWorld,
    tileToMountainWorld,
    tileToWorld,
    getMountainStepWaypoints,
    rollDiceValues,
    resolveTurn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardConfig;
  } else {
    root.BoardConfig = BoardConfig;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);

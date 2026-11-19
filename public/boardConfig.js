(function (root) {
  'use strict';

  const TILE_SIZE = 2.2;
  const TILE_GAP = 0.14;
  const STEP_PITCH = TILE_SIZE + TILE_GAP;
  const ROW_HEIGHT = 0.45;

  // 8 Tangga (bawah -> atas), dipastikan tidak bertabrakan dengan rintangan/mystery
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

  // 8 Jalur Rintangan Turun (atas -> bawah), dipastikan tidak bertabrakan dengan tangga/mystery
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

  const HAZARDS = {
    ...STREAMS,
    ...LANDSLIDES
  };
  const SNAKES = HAZARDS;

  // 10 Petak Kejutan (Mystery Tiles) bebas bentrok
  const MYSTERY_TILES = [8, 19, 29, 36, 48, 57, 68, 79, 86, 94];

  const WILDERNESS_ZONES = [
    [15, 22],
    [45, 50],
    [63, 68]
  ];

  const GOOD_MYSTERY_REWARDS = [
    {
      id: 'SHIELD',
      icon: '🛡️',
      title: 'Tameng Kebal Jatuh',
      desc: 'Melindungi 1x dari jalur rintangan turun (sungai jeram, longsor, atau seluncuran)!'
    },
    {
      id: 'BOOST_3',
      icon: '🚀',
      title: 'Dorongan Semangat +3',
      desc: 'Melangkah maju 3 petak!',
      delta: 3
    },
    {
      id: 'BOOST_4',
      icon: '🥾',
      title: 'Langkah Ekspedisi +4',
      desc: 'Berjalan cepat maju 4 petak!',
      delta: 4
    },
    {
      id: 'MAGNET',
      icon: '🧭',
      title: 'Kompas Magnet Tangga',
      desc: 'Tertarik maju menuju kaki tangga terdekat di depan!'
    },
    {
      id: 'EXTRA_DICE',
      icon: '🎲',
      title: 'Bonus Dadu Ekstra',
      desc: 'Mendapatkan 1x lemparan dadu tambahan!'
    }
  ];

  const BAD_MYSTERY_PENALTIES = [
    {
      id: 'TRAP_2',
      icon: '⚠️',
      title: 'Jebakan Kabut -2',
      desc: 'Salah arah di tengah kabut, mundur 2 petak!',
      delta: -2
    },
    {
      id: 'TRAP_3',
      icon: '🪨',
      title: 'Kerikil Licin -3',
      desc: 'Terpeleset mundur 3 petak!',
      delta: -3
    },
    {
      id: 'TRAP_4',
      icon: '🌪️',
      title: 'Angin Badai -4',
      desc: 'Terdorong angin kencang mundur 4 petak!',
      delta: -4
    }
  ];

  const MYSTERY_QUIZZES = [
    {
      id: 'q1',
      category: 'Alam & Gunung',
      question: 'Gunung berapi tertinggi di Indonesia yang berada di Pulau Jawa adalah?',
      options: ['Gunung Bromo', 'Gunung Semeru', 'Gunung Merapi', 'Gunung Rinjani'],
      answerIndex: 1
    },
    {
      id: 'q2',
      category: 'Sains',
      question: 'Gas apakah yang jumlahnya paling banyak di atmosfer Bumi?',
      options: ['Oksigen', 'Karbon Dioksida', 'Nitrogen', 'Hidrogen'],
      answerIndex: 2
    },
    {
      id: 'q3',
      category: 'Pengetahuan Umum',
      question: 'Berapa jumlah sisi yang dimiliki sebuah dadu kubus standar?',
      options: ['4 sisi', '6 sisi', '8 sisi', '12 sisi'],
      answerIndex: 1
    },
    {
      id: 'q4',
      category: 'Logika',
      question: 'Jika 1 + 4 = 5, 2 + 5 = 12, 3 + 6 = 21, maka nilai 4 + 7 = ...?',
      options: ['28', '30', '32', '36'],
      answerIndex: 2
    },
    {
      id: 'q5',
      category: 'Alam & Gunung',
      question: 'Alat navigasi tradisional yang jarumnya selalu menunjuk ke arah utara magnet bumi adalah?',
      options: ['Altimeter', 'Kompas', 'Barometer', 'Higrometer'],
      answerIndex: 1
    },
    {
      id: 'q6',
      category: 'Sains',
      question: 'Planet terbesar dalam tata surya kita adalah?',
      options: ['Saturnus', 'Mars', 'Jupiter', 'Neptunus'],
      answerIndex: 2
    },
    {
      id: 'q7',
      category: 'Alam & Gunung',
      question: 'Proses penguapan air dari permukaan laut dan sungai oleh panas matahari disebut?',
      options: ['Kondensasi', 'Evaporasi', 'Presipitasi', 'Infiltrasi'],
      answerIndex: 1
    },
    {
      id: 'q8',
      category: 'Logika',
      question: 'Di suatu lomba lari, kamu berhasil menyalip peserta di posisi ke-2. Sekarang kamu di posisi ke berapa?',
      options: ['Posisi ke-1', 'Posisi ke-2', 'Posisi ke-3', 'Posisi ke-4'],
      answerIndex: 1
    },
    {
      id: 'q9',
      category: 'Pengetahuan Umum',
      question: 'Samudra paling luas di permukaan Bumi adalah?',
      options: ['Samudra Atlantik', 'Samudra Hindia', 'Samudra Arktik', 'Samudra Pasifik'],
      answerIndex: 3
    },
    {
      id: 'q10',
      category: 'Sains',
      question: 'Pada suhu berapakah air murni mendidih pada tekanan 1 atmosfer di permukaan laut?',
      options: ['80 °C', '90 °C', '100 °C', '110 °C'],
      answerIndex: 2
    },
    {
      id: 'q11',
      category: 'Alam & Gunung',
      question: 'Danau vulkanik terbesar di Indonesia yang berada di Sumatra Utara adalah?',
      options: ['Danau Maninjau', 'Danau Toba', 'Danau Singkarak', 'Danau Poso'],
      answerIndex: 1
    },
    {
      id: 'q12',
      category: 'Logika',
      question: 'Deret angka: 3, 6, 12, 24, ... Angka selanjutnya adalah?',
      options: ['36', '42', '48', '54'],
      answerIndex: 2
    },
    {
      id: 'q13',
      category: 'Pengetahuan Umum',
      question: 'Benua manakah yang memiliki jumlah negara terbanyak di dunia?',
      options: ['Asia', 'Eropa', 'Amerika Selatan', 'Afrika'],
      answerIndex: 3
    },
    {
      id: 'q14',
      category: 'Sains',
      question: 'Bagian tumbuhan hijau yang menjadi tempat utama berlangsungnya fotosintesis adalah?',
      options: ['Akar', 'Batang', 'Daun', 'Biji'],
      answerIndex: 2
    },
    {
      id: 'q15',
      category: 'Alam & Gunung',
      question: 'Fenomena turunnya suhu udara rata-rata sekitar 0,6 °C setiap naik 100 meter di gunung membuat udara puncak terasa?',
      options: ['Lebih panas', 'Lebih dingin', 'Lebih lembap pekat', 'Tak berubah'],
      answerIndex: 1
    },
    {
      id: 'q16',
      category: 'Logika',
      question: 'Jumlah titik total pada dua sisi yang berlawanan pada dadu standar selalu sama dengan?',
      options: ['6', '7', '8', '9'],
      answerIndex: 1
    },
    {
      id: 'q17',
      category: 'Pengetahuan Umum',
      question: 'Negara yang terkenal dengan julukan Negeri Matahari Terbit adalah?',
      options: ['Korea Selatan', 'Thailand', 'Jepang', 'Vietnam'],
      answerIndex: 2
    },
    {
      id: 'q18',
      category: 'Sains',
      question: 'Alat untuk mengukur ketinggian suatu tempat dari permukaan laut saat mendaki adalah?',
      options: ['Altimeter', 'Anemometer', 'Amperemeter', 'Termometer'],
      answerIndex: 0
    },
    {
      id: 'q19',
      category: 'Alam & Gunung',
      question: 'Puncak tertinggi di Indonesia sekaligus masuk daftar Seven Summits dunia adalah?',
      options: ['Puncak Jaya (Carstensz)', 'Gunung Kerinci', 'Gunung Latimojong', 'Gunung Agung'],
      answerIndex: 0
    },
    {
      id: 'q20',
      category: 'Logika',
      question: 'Ayah memiliki 4 anak: Senin, Selasa, Rabu. Siapa nama anak ke-4 jika seluruhnya sudah disebut kecuali satu nama yang paling mungkin di cerita?',
      options: ['Kamis', 'Jumat', 'Sabtu', 'Anak terakhir bernama sesuai penanya: Kamu'],
      answerIndex: 0
    }
  ];

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

  function getWildernessZoneIndex(tile) {
    const t = Number(tile);
    return WILDERNESS_ZONES.findIndex(([a, b]) => t >= a && t <= b);
  }

  function isWildernessTile(tile) {
    return getWildernessZoneIndex(tile) !== -1;
  }

  function getQuizForTile(tile, rngFn) {
    const rand = typeof rngFn === 'function' ? rngFn : Math.random;
    const idx = Math.floor(rand() * MYSTERY_QUIZZES.length);
    return MYSTERY_QUIZZES[idx];
  }

  function resolvePostWalkTile(startTile, delta, playerState) {
    let shield = Boolean(playerState && playerState.shield);
    const steps = [];
    const walkRes = buildStepPath(startTile, delta);
    let curr = walkRes.endTile;

    if (walkRes.path.length > 0) {
      steps.push({
        type: 'walk',
        from: startTile,
        to: curr,
        path: walkRes.path,
        bounced: delta > 0 && startTile + delta > 100
      });
    }

    if (curr !== 100) {
      if (LADDERS[curr]) {
        const dest = LADDERS[curr];
        steps.push({
          type: 'ladder',
          from: curr,
          to: dest
        });
        curr = dest;
      } else if (HAZARDS[curr]) {
        const dest = HAZARDS[curr];
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

    return {
      startTile,
      endTile: curr,
      shieldAfter: shield,
      steps,
      won: curr === 100
    };
  }

  function resolveQuizAnswer(playerState, quizId, selectedIdx, rngFn) {
    const rand = typeof rngFn === 'function' ? rngFn : Math.random;
    const quiz = MYSTERY_QUIZZES.find((q) => q.id === quizId) || MYSTERY_QUIZZES[0];
    const pickedIdx = Number(selectedIdx);
    const isCorrect = pickedIdx === quiz.answerIndex;
    const startTile = playerState.tile || 0;
    const shieldNow = Boolean(playerState.shield);

    const pool = isCorrect ? GOOD_MYSTERY_REWARDS : BAD_MYSTERY_PENALTIES;
    const outcome = { ...pool[Math.floor(rand() * pool.length)] };

    if (outcome.id === 'SHIELD') {
      return {
        quizId: quiz.id,
        selectedIdx: pickedIdx,
        correctIdx: quiz.answerIndex,
        isCorrect,
        outcome,
        startTile,
        endTile: startTile,
        shieldAfter: true,
        steps: [{ type: 'card_shield', tile: startTile }],
        won: false,
        grantExtraTurn: false
      };
    }

    if (outcome.id === 'EXTRA_DICE') {
      return {
        quizId: quiz.id,
        selectedIdx: pickedIdx,
        correctIdx: quiz.answerIndex,
        isCorrect,
        outcome,
        startTile,
        endTile: startTile,
        shieldAfter: shieldNow,
        steps: [{ type: 'card_extra_dice', tile: startTile }],
        won: false,
        grantExtraTurn: true
      };
    }

    let delta = outcome.delta || 0;
    if (outcome.id === 'MAGNET') {
      const ladderStarts = Object.keys(LADDERS)
        .map(Number)
        .filter((k) => k > startTile && k - startTile <= 10)
        .sort((a, b) => a - b);
      delta = ladderStarts.length > 0 ? ladderStarts[0] - startTile : 4;
    }

    const walkEffect = resolvePostWalkTile(startTile, delta, playerState);
    return {
      quizId: quiz.id,
      selectedIdx: pickedIdx,
      correctIdx: quiz.answerIndex,
      isCorrect,
      outcome,
      startTile,
      endTile: walkEffect.endTile,
      shieldAfter: walkEffect.shieldAfter,
      steps: walkEffect.steps,
      won: walkEffect.won,
      grantExtraTurn: false
    };
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

    let pendingQuiz = null;

    // 2. Cek apakah mendarat tepat di petak 100
    if (curr !== 100) {
      // 3. Cek Mystery Tile -> memicu Kuis Pertanyaan interaktif (hadiah acak langsung)
      if (mysteryEnabled && MYSTERY_TILES.includes(curr)) {
        pendingQuiz = getQuizForTile(curr, rand);
        steps.push({
          type: 'mystery_quiz',
          tile: curr,
          quiz: pendingQuiz
        });
      } else {
        // 4. Cek Tangga atau Rintangan Turun pada petak pendaratan
        if (LADDERS[curr]) {
          const dest = LADDERS[curr];
          steps.push({
            type: 'ladder',
            from: curr,
            to: dest
          });
          curr = dest;
        } else if (HAZARDS[curr]) {
          const dest = HAZARDS[curr];
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
      pendingQuiz,
      pendingQuest: pendingQuiz,
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
    HAZARDS,
    SNAKES,
    MYSTERY_TILES,
    WILDERNESS_ZONES,
    MYSTERY_QUIZZES,
    GOOD_MYSTERY_REWARDS,
    BAD_MYSTERY_PENALTIES,
    CHARACTERS,
    EMOTES,
    tileToGrid,
    tileToClassicWorld,
    tileToMountainWorld,
    tileToWorld,
    getWildernessZoneIndex,
    isWildernessTile,
    getMountainStepWaypoints,
    rollDiceValues,
    getQuizForTile,
    resolvePostWalkTile,
    resolveQuizAnswer,
    resolveTurn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoardConfig;
  } else {
    root.BoardConfig = BoardConfig;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);

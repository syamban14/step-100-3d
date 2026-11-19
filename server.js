const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const BoardConfig = require('./public/boardConfig.js');

const PORT = Number(process.env.PORT) || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));

const rooms = new Map();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    rooms: rooms.size
  });
});

const BOT_NAMES = ['Bot Komodo', 'Bot Garuda', 'Bot Cendrawasih', 'Bot Harimau'];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function getAvailableCharacterId(room, preferredId) {
  const used = new Set(room.players.map((p) => p.characterId));
  if (preferredId && BoardConfig.CHARACTERS.some((c) => c.id === preferredId) && !used.has(preferredId)) {
    return preferredId;
  }
  const unused = BoardConfig.CHARACTERS.find((c) => !used.has(c.id));
  return unused ? unused.id : BoardConfig.CHARACTERS[0].id;
}

function sanitizeName(name, fallback) {
  const cleaned = String(name || '').trim().slice(0, 18);
  return cleaned || fallback;
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: { ...room.settings },
    turnIndex: room.turnIndex,
    isTurnResolving: room.isTurnResolving,
    winnerId: room.winnerId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      isBot: p.isBot,
      connected: p.connected,
      tile: p.tile,
      shield: p.shield,
      consecutiveBonus: p.consecutiveBonus
    }))
  };
}

function estimateAnimDurationMs(result) {
  let ms = result.diceValues ? 1250 : 250; // Lempar dadu 3D & pantulan jika ada
  for (const step of result.steps || []) {
    if (step.type === 'walk') {
      ms += Math.max(1, step.path.length) * 780 + 250;
    } else if (step.type === 'mystery_quiz') {
      ms += 900;
    } else if (step.type === 'ladder') {
      ms += 1850;
    } else if (step.type === 'snake') {
      ms += 2050;
    } else if (step.type === 'shield_saved' || step.type === 'card_shield' || step.type === 'card_extra_dice') {
      ms += 800;
    }
  }
  return ms + 350;
}

function clearRoomTimers(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
  if (room.questTimer) {
    clearTimeout(room.questTimer);
    room.questTimer = null;
  }
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

function finalizeTurnAfterActions(room, player, won, extraTurn) {
  room.isTurnResolving = false;
  if (won) {
    room.phase = 'finished';
    room.winnerId = player.id;
    io.to(room.code).emit('game_over', {
      winnerId: player.id,
      room: serializeRoom(room)
    });
    return;
  }
  if (!extraTurn) {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
  }
  io.to(room.code).emit('turn_ready', {
    room: serializeRoom(room),
    extraTurn: Boolean(extraTurn)
  });
  scheduleBotIfNeeded(room);
}

function executeOnlineQuizSteps(room) {
  const pending = room.pendingQuiz;
  if (!pending || !pending.answerResult) return;
  const player = room.players.find((p) => p.id === pending.playerId);
  if (!player) return;

  room.pendingQuiz = null;
  room.isTurnResolving = true;

  const quizResult = pending.answerResult;
  const grantExtraTurn = Boolean(quizResult.grantExtraTurn) || Boolean(pending.extraTurn);
  const animDurationMs = estimateAnimDurationMs({ steps: quizResult.steps });

  io.to(room.code).emit('quiz_executed', {
    playerId: player.id,
    quizResult,
    room: serializeRoom(room)
  });

  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    finalizeTurnAfterActions(room, player, quizResult.won, grantExtraTurn);
  }, animDurationMs);
}

function applyOnlineQuizAnswer(room, playerId, selectedIdx) {
  const pending = room.pendingQuiz;
  if (!pending || pending.playerId !== playerId || pending.answerResult) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;

  const idx = Number(selectedIdx);
  const validIdx = Number.isInteger(idx) && idx >= 0 && idx < pending.quiz.options.length ? idx : 0;
  const quizRes = BoardConfig.resolveQuizAnswer(player, pending.quiz.id, validIdx);
  pending.answerResult = quizRes;
  player.tile = quizRes.endTile;
  player.shield = quizRes.shieldAfter;

  io.to(room.code).emit('quiz_revealed', {
    playerId: player.id,
    quizResult: quizRes
  });

  if (room.questTimer) clearTimeout(room.questTimer);
  room.questTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    executeOnlineQuizSteps(room);
  }, 1450);
}

function scheduleOnlineBotQuiz(room) {
  if (!room || room.phase !== 'playing' || !room.pendingQuiz) return;
  const pending = room.pendingQuiz;
  const player = room.players.find((p) => p.id === pending.playerId);
  if (!player) return;

  if (room.questTimer) clearTimeout(room.questTimer);
  room.questTimer = setTimeout(() => {
    if (!rooms.has(room.code) || !room.pendingQuiz || room.pendingQuiz.answerResult) return;
    const q = pending.quiz;
    const isBotCorrect = Math.random() < 0.6;
    let pick = q.answerIndex;
    if (!isBotCorrect) {
      const wrongIndices = [0, 1, 2, 3].filter((i) => i !== q.answerIndex);
      pick = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
    }
    applyOnlineQuizAnswer(room, player.id, pick);
  }, 1000);
}

function scheduleBotIfNeeded(room) {
  if (room.phase !== 'playing' || room.isTurnResolving || room.pendingQuiz) return;
  const active = room.players[room.turnIndex];
  if (!active) return;
  if (active.isBot || !active.connected) {
    if (room.botTimer) clearTimeout(room.botTimer);
    room.botTimer = setTimeout(() => {
      executeTurn(room, active.id);
    }, 900);
  }
}

function executeTurn(room, playerId) {
  if (!room || room.phase !== 'playing' || room.isTurnResolving || room.pendingQuiz) return;
  const currentPlayer = room.players[room.turnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId) return;

  room.isTurnResolving = true;

  const diceValues = BoardConfig.rollDiceValues(room.settings.diceCount);
  const result = BoardConfig.resolveTurn(currentPlayer, diceValues, room.settings);

  // Perbarui state otoritatif di server
  currentPlayer.tile = result.endTile;
  currentPlayer.shield = result.shieldAfter;
  currentPlayer.consecutiveBonus = result.nextConsecutiveBonus;

  const animDurationMs = estimateAnimDurationMs(result);

  io.to(room.code).emit('turn_executed', {
    playerId: currentPlayer.id,
    result,
    animDurationMs
  });

  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;

    const quizObj = result.pendingQuiz || result.pendingQuest;
    if (quizObj) {
      room.isTurnResolving = false;
      room.pendingQuiz = {
        playerId: currentPlayer.id,
        tile: currentPlayer.tile,
        quiz: quizObj,
        extraTurn: result.extraTurn,
        answerResult: null
      };
      io.to(room.code).emit('quiz_prompt', {
        playerId: currentPlayer.id,
        tile: currentPlayer.tile,
        quiz: quizObj,
        room: serializeRoom(room)
      });
      if (currentPlayer.isBot || !currentPlayer.connected) {
        scheduleOnlineBotQuiz(room);
      }
      return;
    }

    finalizeTurnAfterActions(room, currentPlayer, result.won, result.extraTurn);
  }, animDurationMs);
}

function removeSocketFromCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;

  socket.leave(code);

  const playerIdx = room.players.findIndex((p) => p.id === socket.id);
  if (playerIdx === -1) return;

  if (room.phase === 'lobby') {
    room.players.splice(playerIdx, 1);
  } else {
    room.players[playerIdx].connected = false;
  }

  const connectedHumans = room.players.filter((p) => !p.isBot && p.connected);
  if (connectedHumans.length === 0) {
    clearRoomTimers(room);
    room.cleanupTimer = setTimeout(() => {
      rooms.delete(code);
    }, 30000);
    return;
  }

  // Migrasi host jika host keluar
  if (room.hostId === socket.id) {
    room.hostId = connectedHumans[0].id;
  }

  io.to(code).emit('room_updated', { room: serializeRoom(room) });

  if (room.phase === 'playing') {
    if (room.pendingQuiz && room.pendingQuiz.playerId === socket.id) {
      scheduleOnlineBotQuiz(room);
    } else {
      scheduleBotIfNeeded(room);
    }
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', (payload = {}, cb) => {
    removeSocketFromCurrentRoom(socket);

    const code = generateRoomCode();
    const playerName = sanitizeName(payload.playerName, 'Pemain 1');
    const settings = {
      diceCount: payload.settings?.diceCount === 2 ? 2 : 1,
      mysteryTiles: payload.settings?.mysteryTiles !== false,
      boardStyle: payload.settings?.boardStyle === 'classic' ? 'classic' : 'mountain'
    };

    const room = {
      code,
      hostId: socket.id,
      phase: 'lobby',
      settings,
      turnIndex: 0,
      isTurnResolving: false,
      pendingQuiz: null,
      winnerId: null,
      turnTimer: null,
      botTimer: null,
      questTimer: null,
      cleanupTimer: null,
      players: []
    };

    const characterId = getAvailableCharacterId(room, payload.characterId);
    room.players.push({
      id: socket.id,
      name: playerName,
      characterId,
      isBot: false,
      connected: true,
      tile: 0,
      shield: false,
      consecutiveBonus: 0
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    if (typeof cb === 'function') {
      cb({ ok: true, code, playerId: socket.id, room: serializeRoom(room) });
    }
  });

  socket.on('join_room', (payload = {}, cb) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Kode room tidak ditemukan.' });
      return;
    }
    if (room.phase !== 'lobby') {
      if (typeof cb === 'function') cb({ ok: false, error: 'Permainan sudah dimulai di room ini.' });
      return;
    }
    if (room.players.length >= 4) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Room sudah penuh (maksimal 4 pemain).' });
      return;
    }

    removeSocketFromCurrentRoom(socket);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    const playerName = sanitizeName(payload.playerName, `Pemain ${room.players.length + 1}`);
    const characterId = getAvailableCharacterId(room, payload.characterId);

    room.players.push({
      id: socket.id,
      name: playerName,
      characterId,
      isBot: false,
      connected: true,
      tile: 0,
      shield: false,
      consecutiveBonus: 0
    });

    socket.join(code);
    socket.data.roomCode = code;

    io.to(code).emit('room_updated', { room: serializeRoom(room) });
    if (typeof cb === 'function') {
      cb({ ok: true, code, playerId: socket.id, room: serializeRoom(room) });
    }
  });

  socket.on('leave_room', () => {
    removeSocketFromCurrentRoom(socket);
  });

  socket.on('update_settings', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;

    if (payload.diceCount === 1 || payload.diceCount === 2) {
      room.settings.diceCount = payload.diceCount;
    }
    if (typeof payload.mysteryTiles === 'boolean') {
      room.settings.mysteryTiles = payload.mysteryTiles;
    }
    if (payload.boardStyle === 'mountain' || payload.boardStyle === 'classic') {
      room.settings.boardStyle = payload.boardStyle;
    }
    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('select_character', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby') return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const charId = payload.characterId;
    if (!BoardConfig.CHARACTERS.some((c) => c.id === charId)) return;

    const takenBy = room.players.find((p) => p.id !== socket.id && p.characterId === charId);
    if (takenBy) {
      if (takenBy.isBot) {
        takenBy.characterId = player.characterId;
        player.characterId = charId;
      } else {
        return;
      }
    } else {
      player.characterId = charId;
    }

    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('add_bot', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (room.players.length >= 4) return;

    const usedNames = new Set(room.players.map((p) => p.name));
    const botName = BOT_NAMES.find((n) => !usedNames.has(n)) || `Bot ${room.players.length + 1}`;
    const characterId = getAvailableCharacterId(room);

    room.players.push({
      id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: botName,
      characterId,
      isBot: true,
      connected: true,
      tile: 0,
      shield: false,
      consecutiveBonus: 0
    });

    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('remove_player', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    const targetId = payload.targetId;
    if (!targetId || targetId === socket.id) return;

    const idx = room.players.findIndex((p) => p.id === targetId);
    if (idx === -1) return;

    const target = room.players[idx];
    room.players.splice(idx, 1);

    if (!target.isBot) {
      const targetSocket = io.sockets.sockets.get(target.id);
      if (targetSocket) {
        targetSocket.leave(room.code);
        targetSocket.data.roomCode = null;
        targetSocket.emit('kicked_from_room');
      }
    }

    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('start_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (room.players.length < 2) return;

    clearRoomTimers(room);
    room.phase = 'playing';
    room.turnIndex = 0;
    room.isTurnResolving = false;
    room.pendingQuiz = null;
    room.winnerId = null;

    for (const p of room.players) {
      p.tile = 0;
      p.shield = false;
      p.consecutiveBonus = 0;
    }

    io.to(room.code).emit('game_started', { room: serializeRoom(room) });
    scheduleBotIfNeeded(room);
  });

  socket.on('roll_dice', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    executeTurn(room, socket.id);
  });

  socket.on('quiz_answer', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.pendingQuiz || room.pendingQuiz.playerId !== socket.id) return;
    applyOnlineQuizAnswer(room, socket.id, payload.selectedIdx);
  });

  socket.on('quest_choose', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.pendingQuiz || room.pendingQuiz.playerId !== socket.id) return;
    applyOnlineQuizAnswer(room, socket.id, payload.choiceIdx);
  });

  socket.on('quiz_execute', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.pendingQuiz || room.pendingQuiz.playerId !== socket.id) return;
    if (!room.pendingQuiz.answerResult) return;
    if (room.questTimer) {
      clearTimeout(room.questTimer);
      room.questTimer = null;
    }
    executeOnlineQuizSteps(room);
  });

  socket.on('send_emote', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const emote = BoardConfig.EMOTES.find((e) => e.id === payload.emoteId);
    if (!emote) return;
    io.to(room.code).emit('player_emote', {
      playerId: socket.id,
      emoteId: emote.id,
      emoji: emote.emoji,
      label: emote.label
    });
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    clearRoomTimers(room);

    room.phase = 'playing';
    room.turnIndex = 0;
    room.isTurnResolving = false;
    room.pendingQuiz = null;
    room.winnerId = null;
    for (const p of room.players) {
      p.tile = 0;
      p.shield = false;
      p.consecutiveBonus = 0;
    }
    io.to(room.code).emit('game_started', { room: serializeRoom(room) });
    scheduleBotIfNeeded(room);
  });

  socket.on('back_to_lobby', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    clearRoomTimers(room);

    room.phase = 'lobby';
    room.turnIndex = 0;
    room.isTurnResolving = false;
    room.pendingQuiz = null;
    room.winnerId = null;
    room.players = room.players.filter((p) => p.isBot || p.connected);
    for (const p of room.players) {
      p.tile = 0;
      p.shield = false;
      p.consecutiveBonus = 0;
    }
    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('disconnect', () => {
    removeSocketFromCurrentRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Step 100 3D berjalan di http://localhost:${PORT}`);
});

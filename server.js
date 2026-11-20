const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const BoardConfig = require('./public/boardConfig.js');

const PORT = Number(process.env.PORT) || 3001;
const DISCONNECT_GRACE_MS = 15000;
const LOBBY_DISCONNECT_GRACE_MS = 30000;
const EMPTY_ROOM_CLEANUP_MS = 120000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
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

function generatePlayerId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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
      botTakeover: Boolean(p.botTakeover),
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
      ms += Math.max(1, step.path.length) * 880 + 250;
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
  if (room.disconnectTimers) {
    room.disconnectTimers.forEach((t) => clearTimeout(t));
    room.disconnectTimers.clear();
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
  if (active.isBot || active.botTakeover) {
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
      if (currentPlayer.isBot || currentPlayer.botTakeover) {
        scheduleOnlineBotQuiz(room);
      }
      return;
    }

    finalizeTurnAfterActions(room, currentPlayer, result.won, result.extraTurn);
  }, animDurationMs);
}

function removeSocketFromCurrentRoom(socket, isExplicitLeave = false) {
  const code = socket.data.roomCode;
  const trackedPlayerId = socket.data.playerId || socket.id;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  socket.data.playerId = null;
  if (!room) return;

  socket.leave(code);

  const playerIdx = room.players.findIndex((p) => p.id === trackedPlayerId);
  if (playerIdx === -1) return;
  const player = room.players[playerIdx];

  // Abaikan event disconnect terlambat dari socket lama yang sudah digantikan saat rejoin
  if (!isExplicitLeave && player.socketId && player.socketId !== socket.id) {
    return;
  }

  const prevTimer = room.disconnectTimers.get(player.id);
  if (prevTimer) {
    clearTimeout(prevTimer);
    room.disconnectTimers.delete(player.id);
  }

  if (room.phase === 'lobby') {
    if (isExplicitLeave) {
      room.players.splice(playerIdx, 1);
    } else {
      player.connected = false;
      player.disconnectedAt = Date.now();
      const timer = setTimeout(() => {
        if (!rooms.has(code) || room.phase !== 'lobby') return;
        const idxNow = room.players.findIndex((p) => p.id === player.id);
        if (idxNow !== -1 && !room.players[idxNow].connected) {
          room.players.splice(idxNow, 1);
          const leftHumans = room.players.filter((p) => !p.isBot && p.connected);
          if (leftHumans.length === 0) {
            clearRoomTimers(room);
            rooms.delete(code);
          } else {
            if (room.hostId === player.id) room.hostId = leftHumans[0].id;
            io.to(code).emit('room_updated', { room: serializeRoom(room) });
          }
        }
      }, LOBBY_DISCONNECT_GRACE_MS);
      room.disconnectTimers.set(player.id, timer);
    }
  } else {
    player.connected = false;
    player.disconnectedAt = Date.now();
    if (isExplicitLeave) {
      player.botTakeover = true;
    } else {
      player.botTakeover = false;
      const timer = setTimeout(() => {
        room.disconnectTimers.delete(player.id);
        if (!rooms.has(code) || room.phase !== 'playing') return;
        if (!player.connected) {
          player.botTakeover = true;
          io.to(code).emit('room_updated', { room: serializeRoom(room) });
          if (room.pendingQuiz && room.pendingQuiz.playerId === player.id) {
            scheduleOnlineBotQuiz(room);
          } else {
            scheduleBotIfNeeded(room);
          }
        }
      }, DISCONNECT_GRACE_MS);
      room.disconnectTimers.set(player.id, timer);
    }
  }

  const connectedHumans = room.players.filter((p) => !p.isBot && p.connected);
  if (connectedHumans.length === 0) {
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
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      clearRoomTimers(room);
      rooms.delete(code);
    }, EMPTY_ROOM_CLEANUP_MS);
    return;
  }

  // Migrasi host jika host keluar / putus sementara
  if (room.hostId === player.id) {
    room.hostId = connectedHumans[0].id;
  }

  io.to(code).emit('room_updated', { room: serializeRoom(room) });

  if (isExplicitLeave && room.phase === 'playing') {
    if (room.pendingQuiz && room.pendingQuiz.playerId === player.id) {
      scheduleOnlineBotQuiz(room);
    } else {
      scheduleBotIfNeeded(room);
    }
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', (payload = {}, cb) => {
    removeSocketFromCurrentRoom(socket, true);

    const code = generateRoomCode();
    const playerId = generatePlayerId();
    const playerName = sanitizeName(payload.playerName, 'Pemain 1');
    const settings = {
      diceCount: payload.settings?.diceCount === 2 ? 2 : 1,
      mysteryTiles: payload.settings?.mysteryTiles !== false,
      boardStyle: payload.settings?.boardStyle === 'classic' ? 'classic' : 'mountain'
    };

    const room = {
      code,
      hostId: playerId,
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
      disconnectTimers: new Map(),
      players: []
    };

    const characterId = getAvailableCharacterId(room, payload.characterId);
    room.players.push({
      id: playerId,
      socketId: socket.id,
      name: playerName,
      characterId,
      isBot: false,
      connected: true,
      disconnectedAt: null,
      botTakeover: false,
      tile: 0,
      shield: false,
      consecutiveBonus: 0
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;

    if (typeof cb === 'function') {
      cb({ ok: true, code, playerId, room: serializeRoom(room) });
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

    removeSocketFromCurrentRoom(socket, true);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    const playerId = generatePlayerId();
    const playerName = sanitizeName(payload.playerName, `Pemain ${room.players.length + 1}`);
    const characterId = getAvailableCharacterId(room, payload.characterId);

    room.players.push({
      id: playerId,
      socketId: socket.id,
      name: playerName,
      characterId,
      isBot: false,
      connected: true,
      disconnectedAt: null,
      botTakeover: false,
      tile: 0,
      shield: false,
      consecutiveBonus: 0
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;

    io.to(code).emit('room_updated', { room: serializeRoom(room) });
    if (typeof cb === 'function') {
      cb({ ok: true, code, playerId, room: serializeRoom(room) });
    }
  });

  socket.on('rejoin_room', (payload = {}, cb) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const playerId = String(payload.playerId || '').trim();
    const room = rooms.get(code);
    if (!room || !playerId) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Room atau sesi pemain sudah berakhir.' });
      return;
    }
    const player = room.players.find((p) => p.id === playerId && !p.isBot);
    if (!player) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Pemain tidak ditemukan di room ini.' });
      return;
    }

    if (socket.data.roomCode && socket.data.roomCode !== code) {
      removeSocketFromCurrentRoom(socket, true);
    }

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    const dTimer = room.disconnectTimers.get(player.id);
    if (dTimer) {
      clearTimeout(dTimer);
      room.disconnectTimers.delete(player.id);
    }

    player.socketId = socket.id;
    player.connected = true;
    player.disconnectedAt = null;
    const wasTakeover = Boolean(player.botTakeover);
    player.botTakeover = false;

    const active = room.players[room.turnIndex];
    if (wasTakeover && active && active.id === player.id) {
      if (room.botTimer) {
        clearTimeout(room.botTimer);
        room.botTimer = null;
      }
      if (room.pendingQuiz && room.pendingQuiz.playerId === player.id && !room.pendingQuiz.answerResult && room.questTimer) {
        clearTimeout(room.questTimer);
        room.questTimer = null;
      }
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    io.to(code).emit('room_updated', { room: serializeRoom(room) });

    if (room.phase === 'playing') {
      scheduleBotIfNeeded(room);
    }

    const pendingQuiz = room.pendingQuiz
      ? {
          playerId: room.pendingQuiz.playerId,
          tile: room.pendingQuiz.tile,
          quiz: room.pendingQuiz.quiz,
          answerResult: room.pendingQuiz.answerResult || null
        }
      : null;

    if (typeof cb === 'function') {
      cb({ ok: true, code, playerId: player.id, room: serializeRoom(room), pendingQuiz });
    }
  });

  socket.on('leave_room', () => {
    removeSocketFromCurrentRoom(socket, true);
  });

  socket.on('update_settings', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;

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
    const playerId = socket.data.playerId;
    if (!room || room.phase !== 'lobby') return;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;

    const charId = payload.characterId;
    if (!BoardConfig.CHARACTERS.some((c) => c.id === charId)) return;

    const takenBy = room.players.find((p) => p.id !== playerId && p.characterId === charId);
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
    const playerId = socket.data.playerId;
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;
    if (room.players.length >= 4) return;

    const usedNames = new Set(room.players.map((p) => p.name));
    const botName = BOT_NAMES.find((n) => !usedNames.has(n)) || `Bot ${room.players.length + 1}`;
    const characterId = getAvailableCharacterId(room);

    room.players.push({
      id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      socketId: null,
      name: botName,
      characterId,
      isBot: true,
      connected: true,
      disconnectedAt: null,
      botTakeover: false,
      tile: 0,
      shield: false,
      consecutiveBonus: 0
    });

    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('remove_player', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;
    const targetId = payload.targetId;
    if (!targetId || targetId === playerId) return;

    const idx = room.players.findIndex((p) => p.id === targetId);
    if (idx === -1) return;

    const target = room.players[idx];
    const dTimer = room.disconnectTimers.get(target.id);
    if (dTimer) {
      clearTimeout(dTimer);
      room.disconnectTimers.delete(target.id);
    }
    room.players.splice(idx, 1);

    if (!target.isBot && target.socketId) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.leave(room.code);
        targetSocket.data.roomCode = null;
        targetSocket.data.playerId = null;
        targetSocket.emit('kicked_from_room');
      }
    }

    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('start_game', () => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;
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
      p.botTakeover = false;
    }

    io.to(room.code).emit('game_started', { room: serializeRoom(room) });
    scheduleBotIfNeeded(room);
  });

  socket.on('roll_dice', (cb) => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || !playerId) {
      if (typeof cb === 'function') cb({ ok: false, reason: 'not_in_room' });
      return;
    }
    const active = room.players[room.turnIndex];
    if (room.phase !== 'playing' || room.isTurnResolving || room.pendingQuiz || !active || active.id !== playerId) {
      if (typeof cb === 'function') cb({ ok: false, reason: 'not_ready', room: serializeRoom(room) });
      return;
    }
    executeTurn(room, playerId);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('quiz_answer', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || !room.pendingQuiz || room.pendingQuiz.playerId !== playerId) return;
    applyOnlineQuizAnswer(room, playerId, payload.selectedIdx);
  });

  socket.on('quest_choose', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || !room.pendingQuiz || room.pendingQuiz.playerId !== playerId) return;
    applyOnlineQuizAnswer(room, playerId, payload.choiceIdx);
  });

  socket.on('quiz_execute', () => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || !room.pendingQuiz || room.pendingQuiz.playerId !== playerId) return;
    if (!room.pendingQuiz.answerResult) return;
    if (room.questTimer) {
      clearTimeout(room.questTimer);
      room.questTimer = null;
    }
    executeOnlineQuizSteps(room);
  });

  socket.on('send_emote', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || !playerId) return;
    const emote = BoardConfig.EMOTES.find((e) => e.id === payload.emoteId);
    if (!emote) return;
    io.to(room.code).emit('player_emote', {
      playerId,
      emoteId: emote.id,
      emoji: emote.emoji,
      label: emote.label
    });
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || room.hostId !== playerId) return;
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
      p.botTakeover = false;
    }
    io.to(room.code).emit('game_started', { room: serializeRoom(room) });
    scheduleBotIfNeeded(room);
  });

  socket.on('back_to_lobby', () => {
    const room = rooms.get(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room || room.hostId !== playerId) return;
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
      p.botTakeover = false;
      p.disconnectedAt = null;
    }
    io.to(room.code).emit('room_updated', { room: serializeRoom(room) });
  });

  socket.on('disconnect', () => {
    removeSocketFromCurrentRoom(socket, false);
  });
});

server.listen(PORT, () => {
  console.log(`Step 100 3D berjalan di http://localhost:${PORT}`);
});

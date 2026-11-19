import { GameScene3D } from './scene3d.js';
import { soundFX } from './audio.js';

const BoardConfig = window.BoardConfig;
const isStaticHost = window.location.hostname.endsWith('github.io') || typeof window.io !== 'function';
const socket = !isStaticHost
  ? window.io()
  : {
      on() {},
      emit() {}
    };

// Elemen DOM Utama
const el = {
  canvasContainer: document.getElementById('canvas-container'),
  pawnOverlays: document.getElementById('pawn-overlays'),
  eventBanner: document.getElementById('event-banner'),

  screenHome: document.getElementById('screen-home'),
  screenLocalSetup: document.getElementById('screen-local-setup'),
  screenLobby: document.getElementById('screen-lobby'),
  screenHud: document.getElementById('screen-hud'),
  modalVictory: document.getElementById('modal-victory'),

  inputPlayerName: document.getElementById('input-player-name'),
  inputRoomCode: document.getElementById('input-room-code'),
  homeError: document.getElementById('home-error'),

  btnOpenLocal: document.getElementById('btn-open-local'),
  btnCreateRoom: document.getElementById('btn-create-room'),
  btnJoinRoom: document.getElementById('btn-join-room'),
  btnHomeBoardStyle: document.getElementById('btn-home-board-style'),
  btnHomeTheme: document.getElementById('btn-home-theme'),
  btnHomeSound: document.getElementById('btn-home-sound'),

  btnLocalBack: document.getElementById('btn-local-back'),
  localStyleSeg: document.getElementById('local-style-seg'),
  localDiceSeg: document.getElementById('local-dice-seg'),
  btnLocalMystery: document.getElementById('btn-local-mystery'),
  btnLocalAddSlot: document.getElementById('btn-local-add-slot'),
  localSlotsList: document.getElementById('local-slots-list'),
  btnLocalStart: document.getElementById('btn-local-start'),

  lobbyRoomCode: document.getElementById('lobby-room-code'),
  btnCopyCode: document.getElementById('btn-copy-code'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),
  lobbyPlayerCount: document.getElementById('lobby-player-count'),
  btnLobbyAddBot: document.getElementById('btn-lobby-add-bot'),
  lobbyPlayersList: document.getElementById('lobby-players-list'),
  lobbyCharPicker: document.getElementById('lobby-character-picker'),
  lobbyStyleSeg: document.getElementById('lobby-style-seg'),
  lobbyDiceSeg: document.getElementById('lobby-dice-seg'),
  btnLobbyMystery: document.getElementById('btn-lobby-mystery'),
  lobbyWaitMsg: document.getElementById('lobby-wait-msg'),
  btnLobbyStart: document.getElementById('btn-lobby-start'),

  hudModeBadge: document.getElementById('hud-mode-badge'),
  hudRulesBadge: document.getElementById('hud-rules-badge'),
  btnHudBoardStyle: document.getElementById('btn-hud-board-style'),
  btnCamOverview: document.getElementById('btn-cam-overview'),
  btnCamTpp: document.getElementById('btn-cam-tpp'),
  btnCamFpp: document.getElementById('btn-cam-fpp'),
  btnCamTop: document.getElementById('btn-cam-top'),
  btnToggleAutofollow: document.getElementById('btn-toggle-autofollow'),
  btnHudTheme: document.getElementById('btn-hud-theme'),
  btnHudSound: document.getElementById('btn-hud-sound'),
  btnHudExit: document.getElementById('btn-hud-exit'),
  hudPlayers: document.getElementById('hud-players'),
  hudLogList: document.getElementById('hud-log-list'),
  hudEmoteBar: document.getElementById('hud-emote-bar'),
  hudTurnLabel: document.getElementById('hud-turn-label'),
  hudDiceResult: document.getElementById('hud-dice-result'),
  btnRollDice: document.getElementById('btn-roll-dice'),

  modalQuest: document.getElementById('modal-quest'),
  questBadge: document.getElementById('quest-badge'),
  questTitle: document.getElementById('quest-title'),
  questStory: document.getElementById('quest-story'),
  questChoices: document.getElementById('quest-choices'),
  questResult: document.getElementById('quest-result'),
  questRewardBox: document.getElementById('quest-reward-box'),
  questRewardActions: document.getElementById('quest-reward-actions'),
  questWaitMsg: document.getElementById('quest-wait-msg'),

  victoryTitle: document.getElementById('victory-title'),
  victorySubtitle: document.getElementById('victory-subtitle'),
  victoryStandings: document.getElementById('victory-standings'),
  btnVictoryRematch: document.getElementById('btn-victory-rematch'),
  btnVictoryLobby: document.getElementById('btn-victory-lobby'),
  btnVictoryHome: document.getElementById('btn-victory-home')
};

// Inisialisasi Scene 3D
const scene3d = new GameScene3D(el.canvasContainer, el.pawnOverlays);

// State Aplikasi
const state = {
  mode: null, // 'local' | 'online'
  boardStyle: 'mountain', // 'mountain' | 'classic'
  cameraMode: 'overview', // 'overview' | 'tpp' | 'fpp' | 'top'
  theme: 'day',
  soundOn: true,
  autoFollow: true,

  // Setup Lokal
  localSettings: { diceCount: 1, mysteryTiles: true, boardStyle: 'mountain' },
  localSlots: [
    { name: 'Petualang 1', isBot: false, characterId: 'explorer' },
    { name: 'Bot Komodo', isBot: true, characterId: 'knight' }
  ],

  // State Match Aktif (dipakai baik di Lokal maupun Online)
  room: null,
  myId: null,
  isAnimating: false,
  isQuestOpen: false,
  pendingAnimPromise: Promise.resolve(),
  localBotTimer: null,
  bannerTimer: null
};

function showScreen(screen) {
  el.screenHome.classList.add('hidden');
  el.screenLocalSetup.classList.add('hidden');
  el.screenLobby.classList.add('hidden');
  el.screenHud.classList.add('hidden');

  if (screen === 'home') el.screenHome.classList.remove('hidden');
  else if (screen === 'local-setup') el.screenLocalSetup.classList.remove('hidden');
  else if (screen === 'lobby') el.screenLobby.classList.remove('hidden');
  else if (screen === 'hud') el.screenHud.classList.remove('hidden');
}

function showHomeError(msg) {
  if (!msg) {
    el.homeError.classList.add('hidden');
    return;
  }
  el.homeError.textContent = msg;
  el.homeError.classList.remove('hidden');
}

function showBanner(msg, durationMs = 2400) {
  el.eventBanner.textContent = msg;
  el.eventBanner.classList.remove('hidden');
  if (state.bannerTimer) clearTimeout(state.bannerTimer);
  state.bannerTimer = setTimeout(() => {
    el.eventBanner.classList.add('hidden');
  }, durationMs);
}

function addLog(text) {
  const li = document.createElement('li');
  li.textContent = text;
  el.hudLogList.prepend(li);
  while (el.hudLogList.children.length > 18) {
    el.hudLogList.removeChild(el.hudLogList.lastChild);
  }
}

function toggleTheme() {
  state.theme = state.theme === 'day' ? 'night' : 'day';
  scene3d.setTheme(state.theme);
  const isNight = state.theme === 'night';
  el.btnHomeTheme.textContent = isNight ? '☀️ Mode Siang' : '🌙 Mode Malam';
  el.btnHudTheme.textContent = isNight ? '🌙 Malam' : '☀️ Siang';
}

function toggleSound() {
  state.soundOn = !state.soundOn;
  soundFX.setEnabled(state.soundOn);
  el.btnHomeSound.textContent = state.soundOn ? '🔊 Suara: Aktif' : '🔇 Suara: Mati';
  el.btnHudSound.textContent = state.soundOn ? '🔊 Suara' : '🔇 Mute';
}

function toggleAutoFollow() {
  state.autoFollow = !state.autoFollow;
  scene3d.setAutoFollow(state.autoFollow);
  el.btnToggleAutofollow.classList.toggle('active', state.autoFollow);
  el.btnToggleAutofollow.textContent = state.autoFollow ? '🎯 Auto-Follow: ON' : '🎯 Auto-Follow: OFF';
}

function setCameraModeUI(mode, playerId = null) {
  state.cameraMode = mode;
  const active = getActivePlayer();
  scene3d.setCameraMode(mode, playerId || (active ? active.id : null));
  el.btnCamOverview.classList.toggle('active', mode === 'overview');
  el.btnCamTpp.classList.toggle('active', mode === 'tpp');
  el.btnCamFpp.classList.toggle('active', mode === 'fpp');
  el.btnCamTop.classList.toggle('active', mode === 'top');
  if (
    state.boardStyle === 'mountain' &&
    (mode === 'tpp' || mode === 'fpp') &&
    active &&
    BoardConfig.isWildernessTile(active.tile)
  ) {
    showBanner('🌲 Memasuki Hutan Belantara Gelap...', 2200);
  }
}

function setBoardStyleUI(style) {
  state.boardStyle = style === 'classic' ? 'classic' : 'mountain';
  state.localSettings.boardStyle = state.boardStyle;
  scene3d.setBoardStyle(state.boardStyle);

  const isMountain = state.boardStyle === 'mountain';
  el.btnHomeBoardStyle.textContent = isMountain ? '🏔️ Papan: Gunung' : '🏝️ Papan: Klasik';
  el.btnHudBoardStyle.textContent = isMountain ? '🏔️ Gunung' : '🏝️ Klasik';
  el.localStyleSeg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === state.boardStyle);
  });
}

function toggleBoardStyle() {
  setBoardStyleUI(state.boardStyle === 'mountain' ? 'classic' : 'mountain');
}

el.btnHomeBoardStyle.addEventListener('click', toggleBoardStyle);
el.btnHudBoardStyle.addEventListener('click', toggleBoardStyle);
el.btnHomeTheme.addEventListener('click', toggleTheme);
el.btnHudTheme.addEventListener('click', toggleTheme);
el.btnHomeSound.addEventListener('click', toggleSound);
el.btnHudSound.addEventListener('click', toggleSound);
el.btnToggleAutofollow.addEventListener('click', toggleAutoFollow);

el.btnCamOverview.addEventListener('click', () => setCameraModeUI('overview'));
el.btnCamTpp.addEventListener('click', () => setCameraModeUI('tpp'));
el.btnCamFpp.addEventListener('click', () => setCameraModeUI('fpp'));
el.btnCamTop.addEventListener('click', () => setCameraModeUI('top'));

// Render Bar Emote Cepat
function initEmoteBar() {
  el.hudEmoteBar.innerHTML = '';
  BoardConfig.EMOTES.forEach((em) => {
    const btn = document.createElement('button');
    btn.className = 'emote-btn';
    btn.title = em.label;
    btn.textContent = em.emoji;
    btn.addEventListener('click', () => {
      if (state.mode === 'online') {
        socket.emit('send_emote', { emoteId: em.id });
      } else if (state.mode === 'local' && state.room) {
        const active = getActivePlayer();
        if (active) {
          soundFX.playEmote();
          scene3d.showEmote(active.id, em.emoji, em.label);
        }
      }
    });
    el.hudEmoteBar.appendChild(btn);
  });
}
initEmoteBar();

// ==================== SETUP LOKAL ====================
function renderLocalSlots() {
  el.localSlotsList.innerHTML = '';
  state.localSlots.forEach((slot, idx) => {
    const row = document.createElement('div');
    row.className = 'slot-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 18;
    nameInput.value = slot.name;
    nameInput.addEventListener('input', (e) => {
      slot.name = e.target.value;
    });

    const typeSelect = document.createElement('select');
    typeSelect.innerHTML = `
      <option value="human" ${!slot.isBot ? 'selected' : ''}>👤 Manusia</option>
      <option value="bot" ${slot.isBot ? 'selected' : ''}>🤖 Bot AI</option>
    `;
    typeSelect.addEventListener('change', (e) => {
      slot.isBot = e.target.value === 'bot';
      if (slot.isBot && slot.name.startsWith('Petualang')) {
        slot.name = `Bot ${BoardConfig.CHARACTERS.find((c) => c.id === slot.characterId)?.name || idx + 1}`;
        nameInput.value = slot.name;
      } else if (!slot.isBot && slot.name.startsWith('Bot ')) {
        slot.name = `Pemain ${idx + 1}`;
        nameInput.value = slot.name;
      }
    });

    const charSelect = document.createElement('select');
    BoardConfig.CHARACTERS.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.badge} ${c.name}`;
      if (slot.characterId === c.id) opt.selected = true;
      charSelect.appendChild(opt);
    });
    charSelect.addEventListener('change', (e) => {
      slot.characterId = e.target.value;
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '✕';
    delBtn.disabled = state.localSlots.length <= 2;
    delBtn.addEventListener('click', () => {
      if (state.localSlots.length > 2) {
        state.localSlots.splice(idx, 1);
        renderLocalSlots();
      }
    });

    row.appendChild(nameInput);
    row.appendChild(typeSelect);
    row.appendChild(charSelect);
    row.appendChild(delBtn);
    el.localSlotsList.appendChild(row);
  });

  el.btnLocalAddSlot.disabled = state.localSlots.length >= 4;
}

el.btnOpenLocal.addEventListener('click', () => {
  showHomeError('');
  const customName = el.inputPlayerName.value.trim();
  if (customName) state.localSlots[0].name = customName;
  renderLocalSlots();
  showScreen('local-setup');
});

el.btnLocalBack.addEventListener('click', () => showScreen('home'));

el.localStyleSeg.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setBoardStyleUI(btn.dataset.val);
  });
});

el.localDiceSeg.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.localSettings.diceCount = Number(btn.dataset.val);
    el.localDiceSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

el.btnLocalMystery.addEventListener('click', () => {
  state.localSettings.mysteryTiles = !state.localSettings.mysteryTiles;
  el.btnLocalMystery.classList.toggle('active', state.localSettings.mysteryTiles);
  el.btnLocalMystery.textContent = state.localSettings.mysteryTiles ? 'Aktif' : 'Mati';
});

el.btnLocalAddSlot.addEventListener('click', () => {
  if (state.localSlots.length >= 4) return;
  const usedChars = new Set(state.localSlots.map((s) => s.characterId));
  const nextChar = BoardConfig.CHARACTERS.find((c) => !usedChars.has(c.id)) || BoardConfig.CHARACTERS[0];
  state.localSlots.push({
    name: `Bot ${nextChar.name}`,
    isBot: true,
    characterId: nextChar.id
  });
  renderLocalSlots();
});

el.btnLocalStart.addEventListener('click', startLocalMatch);

function startLocalMatch() {
  if (state.localBotTimer) clearTimeout(state.localBotTimer);
  state.mode = 'local';
  state.myId = null;
  state.isAnimating = false;
  state.isQuestOpen = false;

  const players = state.localSlots.map((s, idx) => ({
    id: `local_${idx}`,
    name: s.name.trim() || `Pemain ${idx + 1}`,
    characterId: s.characterId,
    isBot: s.isBot,
    connected: true,
    tile: 0,
    shield: false,
    consecutiveBonus: 0
  }));

  state.room = {
    code: 'LOKAL',
    hostId: 'local_0',
    phase: 'playing',
    settings: { ...state.localSettings },
    turnIndex: 0,
    winnerId: null,
    players
  };

  enterMatchView();
  scheduleLocalBotIfNeeded();
}

function scheduleLocalBotIfNeeded() {
  if (
    state.mode !== 'local' ||
    !state.room ||
    state.room.phase !== 'playing' ||
    state.isAnimating ||
    state.isQuestOpen
  ) {
    return;
  }
  const active = getActivePlayer();
  if (active && active.isBot) {
    if (state.localBotTimer) clearTimeout(state.localBotTimer);
    state.localBotTimer = setTimeout(() => {
      executeLocalTurn();
    }, 850);
  }
}

async function executeLocalTurn() {
  if (
    state.mode !== 'local' ||
    !state.room ||
    state.room.phase !== 'playing' ||
    state.isAnimating ||
    state.isQuestOpen
  ) {
    return;
  }
  const active = getActivePlayer();
  if (!active) return;

  state.isAnimating = true;
  updateHudState();

  const diceValues = BoardConfig.rollDiceValues(state.room.settings.diceCount);
  const result = BoardConfig.resolveTurn(active, diceValues, state.room.settings);

  await runTurnAnimation(active.id, result);
  if (!state.room) return;

  active.tile = result.endTile;
  active.shield = result.shieldAfter;
  active.consecutiveBonus = result.nextConsecutiveBonus;

  let finalWon = result.won;
  let finalExtraTurn = result.extraTurn;

  const quizObj = result.pendingQuiz || result.pendingQuest;
  if (quizObj) {
    state.isAnimating = false;
    const quizOutcome = await openLocalQuizModal(active, quizObj, active.tile);
    if (!state.room) return;
    if (quizOutcome.won) finalWon = true;
    if (quizOutcome.extraTurnOverride) finalExtraTurn = true;
  }

  state.isAnimating = false;

  if (finalWon) {
    state.room.phase = 'finished';
    state.room.winnerId = active.id;
    showVictoryModal(active.id);
    return;
  }

  if (!finalExtraTurn) {
    state.room.turnIndex = (state.room.turnIndex + 1) % state.room.players.length;
  }

  const nextActive = getActivePlayer();
  scene3d.syncPlayers(state.room.players, nextActive ? nextActive.id : null, false);
  updateHudState();
  if (nextActive && !nextActive.isBot) soundFX.playTurnBell();

  scheduleLocalBotIfNeeded();
}

// ==================== MULTIPLAYER ONLINE ====================
el.btnCreateRoom.addEventListener('click', () => {
  showHomeError('');
  if (isStaticHost) {
    showHomeError('Mode Room Online membutuhkan server Socket.io (Docker/VPS). Di GitHub Pages, silakan gunakan Mode Main Lokal / vs Bot AI!');
    return;
  }
  const playerName = el.inputPlayerName.value.trim() || 'Pemain 1';
  socket.emit('create_room', { playerName, settings: { boardStyle: state.boardStyle } }, (res) => {
    if (!res || !res.ok) {
      showHomeError(res?.error || 'Gagal membuat room.');
      return;
    }
    state.mode = 'online';
    state.myId = res.playerId;
    state.room = res.room;
    renderLobby();
    showScreen('lobby');
  });
});

el.btnJoinRoom.addEventListener('click', () => {
  showHomeError('');
  if (isStaticHost) {
    showHomeError('Mode Room Online membutuhkan server Socket.io (Docker/VPS). Di GitHub Pages, silakan gunakan Mode Main Lokal / vs Bot AI!');
    return;
  }
  const code = el.inputRoomCode.value.trim().toUpperCase();
  if (!code) {
    showHomeError('Masukkan kode room terlebih dahulu.');
    return;
  }
  const playerName = el.inputPlayerName.value.trim() || 'Petualang';
  socket.emit('join_room', { code, playerName }, (res) => {
    if (!res || !res.ok) {
      showHomeError(res?.error || 'Gagal bergabung ke room.');
      return;
    }
    state.mode = 'online';
    state.myId = res.playerId;
    state.room = res.room;
    renderLobby();
    showScreen('lobby');
  });
});

el.btnCopyCode.addEventListener('click', () => {
  if (!state.room) return;
  navigator.clipboard?.writeText(state.room.code).catch(() => {});
  el.btnCopyCode.textContent = '✅ Tersalin';
  setTimeout(() => {
    el.btnCopyCode.textContent = '📋 Salin';
  }, 1500);
});

el.btnLeaveRoom.addEventListener('click', () => {
  socket.emit('leave_room');
  resetToHome();
});

el.btnLobbyAddBot.addEventListener('click', () => {
  socket.emit('add_bot');
});

el.lobbyStyleSeg.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!isHost()) return;
    socket.emit('update_settings', { boardStyle: btn.dataset.val });
  });
});

el.lobbyDiceSeg.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!isHost()) return;
    socket.emit('update_settings', { diceCount: Number(btn.dataset.val) });
  });
});

el.btnLobbyMystery.addEventListener('click', () => {
  if (!isHost() || !state.room) return;
  socket.emit('update_settings', { mysteryTiles: !state.room.settings.mysteryTiles });
});

el.btnLobbyStart.addEventListener('click', () => {
  socket.emit('start_game');
});

function isHost() {
  return state.mode === 'local' || (state.room && state.room.hostId === state.myId);
}

function renderLobby() {
  const room = state.room;
  if (!room) return;
  const host = isHost();

  el.lobbyRoomCode.textContent = room.code;
  el.lobbyPlayerCount.textContent = String(room.players.length);

  el.btnLobbyAddBot.classList.toggle('hidden', !host || room.players.length >= 4);
  el.btnLobbyStart.classList.toggle('hidden', !host);
  el.btnLobbyStart.disabled = room.players.length < 2;
  el.lobbyWaitMsg.textContent =
    room.players.length < 2
      ? 'Minimal 2 pemain (atau tambah Bot AI) untuk memulai.'
      : host
      ? 'Room siap! Tekan Mulai Permainan kapan saja.'
      : 'Menunggu host memulai permainan...';

  // Pengaturan Room
  const roomStyle = room.settings.boardStyle === 'classic' ? 'classic' : 'mountain';
  el.lobbyStyleSeg.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.val === roomStyle);
    btn.disabled = !host;
  });

  el.lobbyDiceSeg.querySelectorAll('button').forEach((btn) => {
    const val = Number(btn.dataset.val);
    btn.classList.toggle('active', room.settings.diceCount === val);
    btn.disabled = !host;
  });
  el.btnLobbyMystery.classList.toggle('active', room.settings.mysteryTiles);
  el.btnLobbyMystery.textContent = room.settings.mysteryTiles ? 'Aktif' : 'Mati';
  el.btnLobbyMystery.disabled = !host;

  // Daftar Pemain
  el.lobbyPlayersList.innerHTML = '';
  room.players.forEach((p) => {
    const charInfo =
      BoardConfig.CHARACTERS.find((c) => c.id === p.characterId) || BoardConfig.CHARACTERS[0];
    const item = document.createElement('div');
    item.className = 'lobby-player-item';

    const meta = document.createElement('div');
    meta.className = 'lobby-player-meta';
    meta.innerHTML = `
      <span class="char-dot" style="background:${charInfo.color}"></span>
      <span>${charInfo.badge} ${p.name}</span>
      ${p.id === room.hostId ? '<span class="tag-mini tag-host">HOST</span>' : ''}
      ${p.isBot ? '<span class="tag-mini">BOT</span>' : ''}
      ${p.id === state.myId ? '<span class="tag-mini">ANDA</span>' : ''}
    `;
    item.appendChild(meta);

    if (host && p.id !== state.myId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn btn-danger btn-sm';
      kickBtn.textContent = 'Hapus';
      kickBtn.addEventListener('click', () => {
        socket.emit('remove_player', { targetId: p.id });
      });
      item.appendChild(kickBtn);
    }

    el.lobbyPlayersList.appendChild(item);
  });

  // Picker Karakter
  const me = room.players.find((p) => p.id === state.myId);
  el.lobbyCharPicker.innerHTML = '';
  BoardConfig.CHARACTERS.forEach((c) => {
    const takenByHuman = room.players.some((p) => p.id !== state.myId && !p.isBot && p.characterId === c.id);
    const selected = me && me.characterId === c.id;

    const card = document.createElement('button');
    card.className = `char-card ${selected ? 'selected' : ''} ${takenByHuman ? 'taken' : ''}`;
    card.disabled = takenByHuman;
    card.innerHTML = `
      <span style="font-size:20px">${c.badge}</span>
      <span>
        <div>${c.name}</div>
        <small style="font-weight:500;opacity:0.75">${takenByHuman ? 'Dipakai' : selected ? 'Dipilih' : 'Pilih'}</small>
      </span>
    `;
    card.addEventListener('click', () => {
      if (!takenByHuman) socket.emit('select_character', { characterId: c.id });
    });
    el.lobbyCharPicker.appendChild(card);
  });
}

socket.on('room_updated', ({ room }) => {
  if (state.mode !== 'online') return;
  state.room = room;
  if (room.phase === 'lobby') {
    el.modalVictory.classList.add('hidden');
    renderLobby();
    showScreen('lobby');
  } else {
    const active = getActivePlayer();
    scene3d.syncPlayers(room.players, active ? active.id : null, false);
    updateHudState();
  }
});

socket.on('game_started', ({ room }) => {
  state.room = room;
  state.isAnimating = false;
  state.isQuestOpen = false;
  state.pendingAnimPromise = Promise.resolve();
  el.modalQuest.classList.add('hidden');
  el.modalVictory.classList.add('hidden');
  enterMatchView();
  const active = getActivePlayer();
  if (active && active.id === state.myId) soundFX.playTurnBell();
});

socket.on('turn_executed', ({ playerId, result }) => {
  if (!state.room) return;
  state.isAnimating = true;
  updateHudState();
  state.pendingAnimPromise = runTurnAnimation(playerId, result);
});

socket.on('quiz_prompt', async ({ playerId, tile, quiz, room }) => {
  await state.pendingAnimPromise;
  if (!state.room) return;
  state.room = room;
  state.isAnimating = false;
  openOnlineQuizModal(playerId, tile, quiz);
  updateHudState();
});

socket.on('quiz_revealed', ({ playerId, quizResult }) => {
  if (!state.room) return;
  revealOnlineQuizOutcome(playerId, quizResult);
});

socket.on('quiz_executed', ({ playerId, quizResult, room }) => {
  if (!state.room) return;
  el.modalQuest.classList.add('hidden');
  state.isQuestOpen = false;
  state.isAnimating = true;
  updateHudState();

  const player = state.room.players.find((p) => p.id === playerId);
  const name = player ? player.name : 'Pemain';
  state.pendingAnimPromise = (async () => {
    const oc = quizResult.outcome;
    if (quizResult.isCorrect) {
      showBanner(`${oc.icon} ${name}: ${oc.title}!`);
      addLog(`${oc.icon} ${name} mendapat hadiah acak: ${oc.title}`);
    } else {
      soundFX.playBounceBack();
      showBanner(`${oc.icon} ${name} terkena ${oc.title}!`);
      addLog(`${oc.icon} ${name} terkena hukuman acak: ${oc.title}`);
    }
    await animateStepsSequence(playerId, quizResult.steps || []);
    state.room = room;
  })();
});

socket.on('turn_ready', async ({ room }) => {
  await state.pendingAnimPromise;
  el.modalQuest.classList.add('hidden');
  state.isQuestOpen = false;
  state.room = room;
  state.isAnimating = false;
  const active = getActivePlayer();
  scene3d.syncPlayers(room.players, active ? active.id : null, true);
  updateHudState();
  if (active && active.id === state.myId) {
    soundFX.playTurnBell();
  }
});

socket.on('game_over', async ({ winnerId, room }) => {
  await state.pendingAnimPromise;
  el.modalQuest.classList.add('hidden');
  state.isQuestOpen = false;
  state.room = room;
  state.isAnimating = false;
  scene3d.syncPlayers(room.players, winnerId, true);
  updateHudState();
  showVictoryModal(winnerId);
});

socket.on('player_emote', ({ playerId, emoji, label }) => {
  soundFX.playEmote();
  scene3d.showEmote(playerId, emoji, label);
});

socket.on('kicked_from_room', () => {
  resetToHome();
  showHomeError('Anda dikeluarkan dari room oleh host.');
});

// ==================== IN-GAME HUD & ANIMASI ====================
function getActivePlayer() {
  if (!state.room || !state.room.players.length) return null;
  return state.room.players[state.room.turnIndex] || null;
}

function enterMatchView() {
  el.hudLogList.innerHTML = '';
  el.modalQuest.classList.add('hidden');
  el.modalVictory.classList.add('hidden');
  state.isQuestOpen = false;
  showScreen('hud');

  setBoardStyleUI(state.room.settings.boardStyle || state.boardStyle);
  scene3d.setMysteryVisible(state.room.settings.mysteryTiles);
  const active = getActivePlayer();
  scene3d.syncPlayers(state.room.players, active ? active.id : null, true);
  setCameraModeUI('overview');

  el.hudModeBadge.textContent = state.mode === 'online' ? `ROOM: ${state.room.code}` : 'MODE LOKAL';
  el.hudRulesBadge.textContent = `${state.room.settings.diceCount} Dadu • Mystery ${
    state.room.settings.mysteryTiles ? 'ON' : 'OFF'
  }`;
  el.hudDiceResult.textContent = 'Siap melempar dadu';

  addLog('Permainan dimulai! Menuju puncak petak 100!');
  updateHudState();
}

function updateHudState() {
  if (!state.room) return;
  const active = getActivePlayer();
  scene3d.setActivePlayer(active ? active.id : null);

  // Render daftar kartu pemain di kiri
  el.hudPlayers.innerHTML = '';
  state.room.players.forEach((p) => {
    const charInfo =
      BoardConfig.CHARACTERS.find((c) => c.id === p.characterId) || BoardConfig.CHARACTERS[0];
    const isAct = active && active.id === p.id;

    const card = document.createElement('div');
    card.className = `hud-player-card ${isAct ? 'active' : ''}`;
    card.dataset.playerId = p.id;
    card.innerHTML = `
      <div class="hp-left">
        <div class="hp-avatar" style="background:${charInfo.color}">${charInfo.badge}</div>
        <div style="min-width:0">
          <div class="hp-name">${p.name} ${p.shield ? '🛡️' : ''}</div>
          <div class="hp-sub">${p.isBot ? 'Bot AI' : p.id === state.myId ? 'Anda' : 'Pemain'}</div>
        </div>
      </div>
      <div class="hp-tile">#${p.tile}</div>
    `;
    el.hudPlayers.appendChild(card);
  });

  if (active) {
    el.hudTurnLabel.textContent = state.isQuestOpen
      ? `❓ ${active.name} menjawab Kuis Mystery...`
      : state.isAnimating
      ? `⏳ ${active.name} bergerak...`
      : `🎯 Giliran: ${active.name}`;
  }

  let canRoll = false;
  if (state.room.phase === 'playing' && !state.isAnimating && !state.isQuestOpen && active && !active.isBot) {
    if (state.mode === 'local') canRoll = true;
    else if (state.mode === 'online' && active.id === state.myId) canRoll = true;
  }
  el.btnRollDice.disabled = !canRoll;
}

function updateHudTileForPlayer(playerId, tile) {
  if (!state.room) return;
  const p = state.room.players.find((pl) => pl.id === playerId);
  if (p) p.tile = tile;
  const card = el.hudPlayers.querySelector(`[data-player-id="${playerId}"] .hp-tile`);
  if (card) card.textContent = `#${tile}`;
}

async function animateStepsSequence(playerId, steps) {
  const player = state.room?.players.find((p) => p.id === playerId);
  const name = player ? player.name : 'Pemain';

  for (const step of steps) {
    if (!state.room) return;
    if (step.type === 'walk') {
      if (step.bounced) {
        showBanner('💥 Kelebihan langkah! Memantul mundur di 100!');
        soundFX.playBounceBack();
      }
      let wasInWild = player ? BoardConfig.isWildernessTile(player.tile) : false;
      await scene3d.animateHopPath(playerId, step.path, (tile, idx) => {
        if (state.boardStyle === 'mountain') soundFX.playFootstep(idx);
        else soundFX.playHop(idx);
        updateHudTileForPlayer(playerId, tile);

        const nowInWild =
          state.boardStyle === 'mountain' &&
          (state.cameraMode === 'tpp' || state.cameraMode === 'fpp') &&
          BoardConfig.isWildernessTile(tile);
        if (nowInWild && !wasInWild) {
          showBanner('🌲 Memasuki Hutan Belantara Gelap...', 2200);
        }
        wasInWild = nowInWild;
      });
    } else if (step.type === 'mystery_quiz') {
      soundFX.playMystery();
      showBanner(`❓ Kuis Mystery #${step.tile}: Jawab pertanyaan untuk hadiah acak!`);
      addLog(`❓ ${name} membuka Kuis Mystery di #${step.tile}`);
    } else if (step.type === 'ladder') {
      soundFX.playLadderClimb();
      showBanner(`🪜 ${name} naik tangga! #${step.from} → #${step.to}`);
      addLog(`🪜 ${name} memanjat tangga #${step.from} → #${step.to}`);
      await scene3d.animateLadderClimb(playerId, step.from, step.to);
      updateHudTileForPlayer(playerId, step.to);
    } else if (step.type === 'snake') {
      soundFX.playSnakeSlide();
      if (state.boardStyle === 'mountain') {
        const isStream = step.hazardKind === 'stream' || Boolean(BoardConfig.STREAMS[step.from]);
        if (isStream) {
          showBanner(`🌊 ${name} terbawa arus sungai jeram! #${step.from} → #${step.to}`);
          addLog(`🌊 ${name} hanyut di sungai #${step.from} → #${step.to}`);
        } else {
          showBanner(`🪨 ${name} tergelincir longsoran tebing! #${step.from} → #${step.to}`);
          addLog(`🪨 ${name} meluncur longsor #${step.from} → #${step.to}`);
        }
      } else {
        showBanner(`🌀 Aduh! ${name} terkena seluncuran rintangan #${step.from} → #${step.to}`);
        addLog(`🌀 ${name} meluncur di rintangan #${step.from} → #${step.to}`);
      }
      await scene3d.animateSnakeSlide(playerId, step.from, step.to);
      updateHudTileForPlayer(playerId, step.to);
    } else if (step.type === 'shield_saved') {
      soundFX.playShieldSave();
      showBanner(`🛡️ Tameng Kebal Jatuh melindungi ${name} di titik #${step.tile}!`);
      addLog(`🛡️ Tameng ${name} pecah menahan rintangan #${step.tile}`);
      scene3d.updatePlayerShield(playerId, false);
      if (player) player.shield = false;
    } else if (step.type === 'card_shield') {
      soundFX.playMystery();
      showBanner(`🛡️ ${name} mendapat Tameng Kebal Jatuh!`);
      addLog(`🛡️ ${name} memasang Tameng Kebal Jatuh`);
      scene3d.updatePlayerShield(playerId, true);
      if (player) player.shield = true;
    } else if (step.type === 'card_extra_dice') {
      soundFX.playMystery();
      showBanner(`🎲 ${name} mendapat Bonus Dadu Ekstra!`);
      addLog(`🎲 ${name} memperoleh lemparan dadu ekstra`);
    }
  }
}

async function runTurnAnimation(playerId, result) {
  const player = state.room?.players.find((p) => p.id === playerId);
  const name = player ? player.name : 'Pemain';

  el.hudDiceResult.textContent = `Dadu: [${result.diceValues.join(' + ')}] = ${result.totalDice}`;
  addLog(`${name} melempar dadu: ${result.diceValues.join(' + ')} (Total ${result.totalDice})`);

  soundFX.playDiceRoll();
  await scene3d.throwDice(result.diceValues);

  await animateStepsSequence(playerId, result.steps || []);

  if (result.extraTurn) {
    showBanner(`🎲 ${name} dapat giliran ekstra!`, 2000);
    addLog(`🎲 ${name} mendapat lemparan bonus!`);
  } else if (result.bonusLimitReached) {
    showBanner('⚠️ Maksimal 3x bonus giliran berturut-turut!', 2000);
  }
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function renderQuizHeaderAndOptions(playerName, tile, quiz, isInteractive, onSelectOption) {
  el.questBadge.textContent = `❓ KUIS MYSTERY PETAK #${tile} • ${quiz.category}`;
  el.questTitle.textContent = quiz.question;
  el.questStory.textContent = 'Jawab dengan benar untuk hadiah acak! Jawaban salah akan terkena hukuman acak.';
  el.questResult.classList.add('hidden');
  el.questRewardBox.innerHTML = '';
  el.questRewardActions.innerHTML = '';
  el.questChoices.innerHTML = '';

  quiz.options.forEach((optText, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quest-choice-btn';
    btn.disabled = !isInteractive;
    btn.innerHTML = `<span><strong>${OPTION_LETTERS[idx] || idx + 1}.</strong> ${optText}</span>`;
    if (isInteractive && typeof onSelectOption === 'function') {
      btn.addEventListener('click', () => onSelectOption(idx));
    }
    el.questChoices.appendChild(btn);
  });

  if (!isInteractive) {
    el.questWaitMsg.textContent = `⏳ Menunggu ${playerName} menjawab kuis...`;
    el.questWaitMsg.classList.remove('hidden');
  } else {
    el.questWaitMsg.classList.add('hidden');
  }

  state.isQuestOpen = true;
  el.modalQuest.classList.remove('hidden');
}

function renderQuizOutcomeFeedback(quizResult) {
  el.questChoices.querySelectorAll('button').forEach((b, bIdx) => {
    b.disabled = true;
    b.classList.toggle('correct', bIdx === quizResult.correctIdx);
    if (!quizResult.isCorrect && bIdx === quizResult.selectedIdx) {
      b.classList.add('wrong');
    }
  });

  const oc = quizResult.outcome;
  if (quizResult.isCorrect) {
    el.questRewardBox.style.borderColor = 'rgba(16, 185, 129, 0.7)';
    el.questRewardBox.innerHTML = `
      <div class="quest-reward-title" style="color:#6ee7b7">✅ Jawaban Benar! Hadiah Acak: ${oc.icon} ${oc.title}</div>
      <div class="quest-reward-desc">${oc.desc}</div>
    `;
  } else {
    el.questRewardBox.style.borderColor = 'rgba(239, 68, 68, 0.7)';
    el.questRewardBox.innerHTML = `
      <div class="quest-reward-title" style="color:#fca5a5">❌ Jawaban Salah! Hukuman Acak: ${oc.icon} ${oc.title}</div>
      <div class="quest-reward-desc">${oc.desc}</div>
    `;
  }
  el.questResult.classList.remove('hidden');
}

function openOnlineQuizModal(playerId, tile, quiz) {
  const player = state.room?.players.find((p) => p.id === playerId);
  const name = player ? player.name : 'Pemain';
  const isMine = playerId === state.myId && !player?.isBot;

  renderQuizHeaderAndOptions(name, tile, quiz, isMine, (idx) => {
    el.questChoices.querySelectorAll('button').forEach((b, bIdx) => {
      b.disabled = true;
      b.classList.toggle('picked', bIdx === idx);
    });
    socket.emit('quiz_answer', { selectedIdx: idx });
  });
}

function revealOnlineQuizOutcome(playerId, quizResult) {
  soundFX.playMystery();
  renderQuizOutcomeFeedback(quizResult);
  el.questRewardActions.innerHTML = '';

  const player = state.room?.players.find((p) => p.id === playerId);
  const name = player ? player.name : 'Pemain';
  const isMine = playerId === state.myId && !player?.isBot;

  if (!isMine) {
    el.questWaitMsg.textContent = `⏳ Menjalankan efek untuk ${name}...`;
    el.questWaitMsg.classList.remove('hidden');
    return;
  }

  el.questWaitMsg.classList.add('hidden');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = quizResult.isCorrect ? 'btn btn-primary' : 'btn btn-danger';
  btn.textContent = '⚡ Jalankan Efek';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    socket.emit('quiz_execute');
  });
  el.questRewardActions.appendChild(btn);
}

function openLocalQuizModal(player, quiz, tile) {
  return new Promise((resolve) => {
    let settled = false;
    let autoExecTimer = null;
    const finish = (outcomeResult) => {
      if (settled) return;
      settled = true;
      if (autoExecTimer) clearTimeout(autoExecTimer);
      el.modalQuest.classList.add('hidden');
      state.isQuestOpen = false;
      resolve(outcomeResult);
    };

    const isHuman = !player.isBot;
    renderQuizHeaderAndOptions(player.name, tile, quiz, isHuman, (idx) => {
      handleAnswer(idx);
    });
    updateHudState();

    const handleAnswer = (selectedIdx) => {
      if (!state.room) {
        finish({ won: false, extraTurnOverride: false });
        return;
      }

      soundFX.playMystery();
      const quizRes = BoardConfig.resolveQuizAnswer(player, quiz.id, selectedIdx);
      renderQuizOutcomeFeedback(quizRes);
      el.questRewardActions.innerHTML = '';

      let executed = false;
      const runEffect = async () => {
        if (executed) return;
        executed = true;
        if (autoExecTimer) clearTimeout(autoExecTimer);
        el.modalQuest.classList.add('hidden');
        state.isQuestOpen = false;
        state.isAnimating = true;
        updateHudState();

        const oc = quizRes.outcome;
        if (quizRes.isCorrect) {
          showBanner(`${oc.icon} ${player.name}: ${oc.title}!`);
          addLog(`✅ ${player.name} menjawab benar → ${oc.title}`);
        } else {
          soundFX.playBounceBack();
          showBanner(`${oc.icon} ${player.name} terkena ${oc.title}!`);
          addLog(`❌ ${player.name} salah menjawab → ${oc.title}`);
        }

        await animateStepsSequence(player.id, quizRes.steps);
        player.tile = quizRes.endTile;
        player.shield = quizRes.shieldAfter;
        finish({ won: quizRes.won, extraTurnOverride: Boolean(quizRes.grantExtraTurn) });
      };

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = quizRes.isCorrect ? 'btn btn-primary' : 'btn btn-danger';
      btn.textContent = '⚡ Jalankan Efek';
      btn.addEventListener('click', runEffect);
      el.questRewardActions.appendChild(btn);

      if (!isHuman) {
        el.questWaitMsg.textContent = quizRes.isCorrect
          ? `🤖 ${player.name} menjawab benar!`
          : `🤖 ${player.name} menjawab salah!`;
        el.questWaitMsg.classList.remove('hidden');
      }

      autoExecTimer = setTimeout(runEffect, 1400);
    };

    if (!isHuman) {
      setTimeout(() => {
        if (!state.room) {
          finish({ won: false, extraTurnOverride: false });
          return;
        }
        const isBotCorrect = Math.random() < 0.6;
        let pick = quiz.answerIndex;
        if (!isBotCorrect) {
          const wrongIndices = [0, 1, 2, 3].filter((i) => i !== quiz.answerIndex);
          pick = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
        }
        handleAnswer(pick);
      }, 1000);
    }
  });
}

el.btnRollDice.addEventListener('click', () => {
  if (el.btnRollDice.disabled) return;
  soundFX.ensureContext();
  if (state.mode === 'local') {
    executeLocalTurn();
  } else if (state.mode === 'online') {
    el.btnRollDice.disabled = true;
    socket.emit('roll_dice');
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!el.screenHud.classList.contains('hidden') && !el.btnRollDice.disabled && !state.isQuestOpen) {
    e.preventDefault();
    el.btnRollDice.click();
  }
});

// ==================== VICTORY & KELUAR ====================
function showVictoryModal(winnerId) {
  const room = state.room;
  if (!room) return;
  const winner = room.players.find((p) => p.id === winnerId) || room.players[0];

  soundFX.playWinFanfare();
  scene3d.spawnWinConfetti(100);
  setCameraModeUI('tpp', winner.id);

  el.victoryTitle.textContent = `🏆 ${winner.name} Menang!`;
  el.victorySubtitle.textContent = 'Selamat! Berhasil menaklukkan puncak petak 100!';

  const sorted = [...room.players].sort((a, b) => b.tile - a.tile);
  el.victoryStandings.innerHTML = '';
  sorted.forEach((p, idx) => {
    const charInfo =
      BoardConfig.CHARACTERS.find((c) => c.id === p.characterId) || BoardConfig.CHARACTERS[0];
    const row = document.createElement('div');
    row.className = 'standing-row';
    row.innerHTML = `
      <span>#${idx + 1} ${charInfo.badge} ${p.name}</span>
      <span style="color:#fde047">Petak ${p.tile}</span>
    `;
    el.victoryStandings.appendChild(row);
  });

  const host = isHost();
  el.btnVictoryRematch.classList.toggle('hidden', !host);
  el.btnVictoryLobby.classList.toggle('hidden', !(state.mode === 'online' && host));
  el.modalVictory.classList.remove('hidden');
}

el.btnVictoryRematch.addEventListener('click', () => {
  if (state.mode === 'local') {
    startLocalMatch();
  } else if (state.mode === 'online') {
    socket.emit('rematch');
  }
});

el.btnVictoryLobby.addEventListener('click', () => {
  if (state.mode === 'online') {
    socket.emit('back_to_lobby');
  }
});

el.btnVictoryHome.addEventListener('click', () => {
  if (state.mode === 'online') socket.emit('leave_room');
  resetToHome();
});

el.btnHudExit.addEventListener('click', () => {
  if (state.mode === 'online') socket.emit('leave_room');
  resetToHome();
});

function resetToHome() {
  if (state.localBotTimer) clearTimeout(state.localBotTimer);
  state.mode = null;
  state.room = null;
  state.myId = null;
  state.isAnimating = false;
  state.isQuestOpen = false;
  el.modalQuest.classList.add('hidden');
  el.modalVictory.classList.add('hidden');
  scene3d.syncPlayers([], null, true);
  scene3d.setMysteryVisible(true);
  setCameraModeUI('overview');
  showScreen('home');
}

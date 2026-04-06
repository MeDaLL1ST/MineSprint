const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.("#0b1020");
tg?.setBackgroundColor?.("#0b1020");

const ADMIN_TG_ID = "887152362";
const LONG_PRESS_MS = 380;
const DRAG_THRESHOLD = 10;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.8;

const $ = (sel) => document.querySelector(sel);

const els = {
  userChip: $("#userChip"),

  rowsInput: $("#rowsInput"),
  colsInput: $("#colsInput"),
  minesInput: $("#minesInput"),

  startSoloBtn: $("#startSoloBtn"),
  createRoomBtn: $("#createRoomBtn"),
  joinBox: $("#joinBox"),
  joinCodeInput: $("#joinCodeInput"),
  joinRoomBtn: $("#joinRoomBtn"),

  roomCard: $("#roomCard"),
  roomCodeValue: $("#roomCodeValue"),
  roomModeValue: $("#roomModeValue"),
  roomOwnerValue: $("#roomOwnerValue"),
  shareBtn: $("#shareBtn"),
  leaveRoomBtn: $("#leaveRoomBtn"),
  restartRoomBtn: $("#restartRoomBtn"),

  modeValue: $("#modeValue"),
  sizeValue: $("#sizeValue"),
  minesValue: $("#minesValue"),
  flagsValue: $("#flagsValue"),
  openedValue: $("#openedValue"),
  sidebarTimerValue: $("#sidebarTimerValue"),

  topMinesValue: $("#topMinesValue"),
  topTimerValue: $("#topTimerValue"),
  modalMinesValue: $("#modalMinesValue"),
  modalTimerValue: $("#modalTimerValue"),

  openFieldBtn: $("#openFieldBtn"),
  closeFieldBtn: $("#closeFieldBtn"),
  zoomInBtn: $("#zoomInBtn"),
  zoomOutBtn: $("#zoomOutBtn"),
  fitZoomBtn: $("#fitZoomBtn"),
  modalRestartBtn: $("#modalRestartBtn"),

  statusText: $("#statusText"),
  badge: $("#badge"),
  boardPreview: $("#boardPreview"),
  boardModal: $("#boardModal"),
  modalBoardScroll: $("#modalBoardScroll"),
  playersGrid: $("#playersGrid"),
  overlay: $("#overlay"),
  overlayTitle: $("#overlayTitle"),
  overlayActionBtn: $("#overlayActionBtn"),
  fieldModal: $("#fieldModal"),

  adminSection: $("#adminSection"),
  refreshAdminBtn: $("#refreshAdminBtn"),
  adminSummary: $("#adminSummary"),
  adminLeaderboard: $("#adminLeaderboard"),
  adminUsers: $("#adminUsers"),
  adminTopUsers: $("#adminTopUsers"),
  adminRecentMatches: $("#adminRecentMatches"),

  toast: $("#toast"),

  boardCard: document.querySelector(".board-card"),
};

let ws = null;
let state = null;
let adminStats = null;
let selectedMode = "solo";
let inputMode = "open";
let autoJoinDone = false;
let reconnectTimer = null;
let boardZoom = 1;
let remoteHovers = {};
let lastHoverCell = null;
let frozenElapsedSec = 0;
let pinchGesture = null;

const activeTouchTimers = new Set();

const presets = {
  solo: { rows: 9, cols: 9, mines: 10 },
  coop: { rows: 12, cols: 12, mines: 24 },
  versus: { rows: 12, cols: 12, mines: 24 },
};

const user = resolveTelegramUser();
const initialRoomCode = new URLSearchParams(location.search).get("room")?.toUpperCase() || "";

bindUI();
applyPresetIfNeeded();
renderBase();
setInterval(updateTopCounters, 1000);

if (isTelegramReady()) {
  connect();
  if (user.id === ADMIN_TG_ID) {
    els.adminSection.classList.remove("hidden");
    loadAdminStats();
  }
} else {
  setBadge("TG ONLY", "danger");
  setStatus("Эту игру нужно открывать внутри Telegram Mini App");
}

function isTelegramReady() {
  return !!tg?.initData;
}

function resolveTelegramUser() {
  const tUser = tg?.initDataUnsafe?.user;
  if (!tUser?.id) {
    return { id: "", name: "Telegram user" };
  }
  const fullName =
    [tUser.first_name, tUser.last_name].filter(Boolean).join(" ").trim() ||
    tUser.username ||
    `user_${tUser.id}`;
  return { id: String(tUser.id), name: fullName };
}

function bindUI() {
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMode = btn.dataset.mode;
      applyPresetIfNeeded();
      renderBase();
    });
  });

  document.querySelectorAll("[data-input]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleInputMode();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [rows, cols, mines] = btn.dataset.preset.split("x").map(Number);
      els.rowsInput.value = rows;
      els.colsInput.value = cols;
      els.minesInput.value = mines;
      renderStats();
    });
  });

  [els.rowsInput, els.colsInput, els.minesInput].forEach((input) => {
    input.addEventListener("input", () => {
      normalizeInputs();
      renderStats();
    });
  });

  els.startSoloBtn.addEventListener("click", () => {
    indicateGameAction("Создаём игру...");
    send({
      type: "start_solo",
      rows: getRows(),
      cols: getCols(),
      mines: getMines(),
    });
    impact("light");
  });

  els.createRoomBtn.addEventListener("click", () => {
    indicateGameAction("Создаём комнату...");
    send({
      type: "create_room",
      mode: selectedMode,
      rows: getRows(),
      cols: getCols(),
      mines: getMines(),
    });
    impact("medium");
  });

  els.joinRoomBtn.addEventListener("click", () => {
    const code = (els.joinCodeInput.value || "").trim().toUpperCase();
    if (!code) {
      toast("Введи код комнаты");
      return;
    }
    indicateGameAction("Подключаемся к комнате...");
    send({ type: "join_room", code });
    impact("light");
  });

  els.shareBtn.addEventListener("click", shareRoomLink);
  els.leaveRoomBtn.addEventListener("click", () => send({ type: "leave_room" }));
  els.restartRoomBtn.addEventListener("click", restartCurrentGame);
  els.overlayActionBtn.addEventListener("click", restartCurrentGame);
  els.modalRestartBtn.addEventListener("click", restartCurrentGame);

  els.openFieldBtn.addEventListener("click", openFieldModal);
  els.closeFieldBtn.addEventListener("click", closeFieldModal);

  els.zoomInBtn.addEventListener("click", () => {
    zoomKeepingViewport(clamp(boardZoom + 0.15, ZOOM_MIN, ZOOM_MAX));
  });

  els.zoomOutBtn.addEventListener("click", () => {
    zoomKeepingViewport(clamp(boardZoom - 0.15, ZOOM_MIN, ZOOM_MAX));
  });

  els.fitZoomBtn.addEventListener("click", fitZoom);

  els.refreshAdminBtn.addEventListener("click", loadAdminStats);

  els.boardPreview.addEventListener("mouseleave", clearHoverCell);
  els.boardModal.addEventListener("mouseleave", clearHoverCell);

  els.fieldModal.addEventListener("click", (e) => {
    if (e.target === els.fieldModal) closeFieldModal();
  });

  els.modalBoardScroll.addEventListener("touchstart", handleModalGestureStart, { passive: false });
  els.modalBoardScroll.addEventListener("touchmove", handleModalGestureMove, { passive: false });
  els.modalBoardScroll.addEventListener("touchend", handleModalGestureEnd, { passive: false });
  els.modalBoardScroll.addEventListener("touchcancel", handleModalGestureEnd, { passive: false });

  els.modalBoardScroll.addEventListener("contextmenu", (e) => e.preventDefault());
  els.boardModal.addEventListener("contextmenu", (e) => e.preventDefault());
  els.boardPreview.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    renderBoards();
    updateTopCounters();
  });
}

function toggleInputMode() {
  inputMode = inputMode === "open" ? "flag" : "open";
  renderModeButtons();
  toast(inputMode === "open" ? "Режим: открыть" : "Режим: флаг");
}

function restartCurrentGame() {
  indicateGameAction("Перезапускаем...");
  if (state?.online) {
    send({ type: "restart_room" });
  } else {
    send({
      type: "start_solo",
      rows: state?.rows || getRows(),
      cols: state?.cols || getCols(),
      mines: state?.mines || getMines(),
    });
  }
  impact("light");
}

function indicateGameAction(text) {
  setStatus(text);
  setBadge("WAIT", "warn");
  toast(text);
  scrollToGame();
}

function scrollToGame() {
  els.boardCard?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyPresetIfNeeded() {
  const preset = presets[selectedMode] || presets.solo;
  els.rowsInput.value = preset.rows;
  els.colsInput.value = preset.cols;
  els.minesInput.value = preset.mines;
}

function normalizeInputs() {
  const rows = Math.max(5, Math.min(30, Number(els.rowsInput.value || 9)));
  const cols = Math.max(5, Math.min(30, Number(els.colsInput.value || 9)));
  const maxMines = Math.max(1, rows * cols - 1);
  const mines = Math.max(1, Math.min(maxMines, Number(els.minesInput.value || 10)));

  els.rowsInput.value = rows;
  els.colsInput.value = cols;
  els.minesInput.value = mines;
}

function getRows() {
  normalizeInputs();
  return Number(els.rowsInput.value);
}

function getCols() {
  normalizeInputs();
  return Number(els.colsInput.value);
}

function getMines() {
  normalizeInputs();
  return Number(els.minesInput.value);
}

function connect() {
  clearTimeout(reconnectTimer);

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    init_data: tg.initData,
  });

  ws = new WebSocket(`${proto}://${location.host}/ws?${params.toString()}`);

  ws.onopen = () => {
    setBadge("ONLINE", "ok");
    setStatus("Соединение установлено");
    if (initialRoomCode && !autoJoinDone) {
      autoJoinDone = true;
      indicateGameAction("Подключаемся к комнате...");
      send({ type: "join_room", code: initialRoomCode });
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    setBadge("OFFLINE", "danger");
    setStatus("Соединение потеряно, переподключаемся...");
    reconnectTimer = setTimeout(connect, 1800);
  };

  ws.onerror = () => {
    toast("Ошибка соединения");
  };
}

function handleMessage(msg) {
  if (msg.type === "hello") {
    els.userChip.textContent = msg.user?.name || user.name;
    return;
  }

  if (msg.type === "room_created") {
    toast(`Комната ${msg.code} создана`);
    setBadge("ROOM", "ok");
    return;
  }

  if (msg.type === "room_joined") {
    toast(msg.message || "Вы вошли в комнату");
    setBadge("ROOM", "ok");
    return;
  }

  if (msg.type === "left_room") {
    toast(msg.message || "Вы вышли");
    state = null;
    remoteHovers = {};
    clearHoverCell(true);
    render();
    return;
  }

  if (msg.type === "hover") {
    if (!state?.online) return;
    if (msg.active && Number.isInteger(msg.cell) && msg.cell >= 0) {
      remoteHovers[msg.playerId] = msg.cell;
    } else {
      delete remoteHovers[msg.playerId];
    }
    applyHoverDecorations();
    return;
  }

  if (msg.type === "state") {
    const prevGameId = state?.gameId || "";
    state = msg.payload;
    selectedMode = state.mode || selectedMode;
    remoteHovers = { ...(state.hovers || {}) };
    clearHoverCell(true);

    if (state.gameId !== prevGameId) {
      boardZoom = defaultZoomForState(state);
      frozenElapsedSec = 0;
    }

    if (state.over) {
      frozenElapsedSec = computeElapsedSec(state);
    }

    setBadge(state.over ? "DONE" : "ONLINE", state.over ? "warn" : "ok");
    render();

    if (state.over) {
      if (user.id === ADMIN_TG_ID) loadAdminStats();
      if (state.won) {
        tg?.HapticFeedback?.notificationOccurred?.("success");
      } else {
        tg?.HapticFeedback?.notificationOccurred?.("warning");
      }
    }
    return;
  }

  if (msg.type === "error") {
    toast(msg.message || "Ошибка");
    setBadge("ERROR", "danger");
    setStatus(msg.message || "Ошибка");
    tg?.HapticFeedback?.notificationOccurred?.("error");
  }
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast("Нет соединения с сервером");
    return;
  }
  ws.send(JSON.stringify(payload));
}

function impact(style = "light") {
  tg?.HapticFeedback?.impactOccurred?.(style);
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setBadge(text, tone) {
  els.badge.textContent = text;
  els.badge.className = `badge badge-${tone}`;
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 1800);
}

function renderBase() {
  renderModeButtons();
  renderRoomControls();
  renderStats();
}

function render() {
  renderBase();
  renderStatus();
  renderPlayers();
  renderBoards();
  renderOverlay();
  updateTopCounters();
  applyHoverDecorations();
}

function renderModeButtons() {
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === selectedMode);
  });

  document.querySelectorAll("[data-input]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.input === inputMode);
  });

  if (!els.userChip.textContent || els.userChip.textContent === "...") {
    els.userChip.textContent = user.name || "Telegram user";
  }
}

function renderRoomControls() {
  const inOnlineState = !!state?.online;
  const isSoloSelected = selectedMode === "solo";
  const hasRoom = !!state?.roomCode;

  els.startSoloBtn.classList.toggle("hidden", !isSoloSelected);
  els.createRoomBtn.classList.toggle("hidden", isSoloSelected || inOnlineState);
  els.joinBox.classList.toggle("hidden", isSoloSelected || inOnlineState);

  els.roomCard.classList.toggle("hidden", !inOnlineState);
  els.shareBtn.classList.toggle("hidden", !hasRoom);

  if (inOnlineState) {
    els.roomCodeValue.textContent = state.roomCode || "-";
    els.roomModeValue.textContent = prettyMode(state.mode);
    const owner = state.players?.find((p) => p.id === state.ownerId);
    els.roomOwnerValue.textContent = owner?.name || state.ownerId || "-";
  }
}

function renderStatus() {
  if (state?.status) {
    setStatus(state.status);
  } else if (isTelegramReady()) {
    setStatus("Выбери режим и начни игру");
  }
}

function renderStats() {
  const rows = state?.rows || getRows();
  const cols = state?.cols || getCols();
  const mines = state?.mines || getMines();

  els.modeValue.textContent = prettyMode(state?.mode || selectedMode);
  els.sizeValue.textContent = `${rows}×${cols}`;
  els.minesValue.textContent = String(mines);
  els.flagsValue.textContent = String(state?.flagsLeft ?? mines);
  els.openedValue.textContent = String(state?.you?.score ?? 0);
  updateTopCounters();
}

function renderPlayers() {
  const online = !!state?.online;
  els.playersGrid.classList.toggle("hidden", !online);

  if (!online) {
    els.playersGrid.innerHTML = "";
    return;
  }

  els.playersGrid.innerHTML = "";
  (state.players || []).forEach((player) => {
    const div = document.createElement("div");
    div.className = "player-card";
    if (player.id === state.you?.id) div.classList.add("me");
    if (state.over && state.winnerId && player.id === state.winnerId) div.classList.add("winner");

    div.innerHTML = `
      <div class="player-row">
        <div class="player-main">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-meta">${player.id === state.you?.id ? "Вы" : "Игрок"}</div>
        </div>
        <div class="player-score">${player.score ?? 0}</div>
      </div>
    `;
    els.playersGrid.appendChild(div);
  });
}

function renderBoards() {
  renderBoardTo(els.boardPreview, false);
  renderBoardTo(els.boardModal, true);
  applyHoverDecorations();
}

function renderBoardTo(container, modal) {
  if (!state) {
    container.innerHTML = `<div class="empty-state">Выбери режим и начни игру</div>`;
    return;
  }

  const cols = state.cols || 9;
  const baseCellSize = modal ? getModalBaseCellSize(cols) : getPreviewBaseCellSize(cols);
  const scale = modal ? boardZoom : 1;
  const cellSize = Math.max(12, Math.round(baseCellSize * scale));
  const cellFont = Math.max(8, Math.round(cellSize * 0.5));
  const gap = cellSize <= 14 ? 2 : cellSize <= 20 ? 3 : 4;

  container.style.setProperty("--cell-size", `${cellSize}px`);
  container.style.setProperty("--cell-font-size", `${cellFont}px`);
  container.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
  container.style.gap = `${gap}px`;
  container.innerHTML = "";

  state.board.forEach((cell) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.dataset.index = String(cell.i);

    if (cell.o) btn.classList.add("open");
    if (cell.f && !cell.o) btn.classList.add("flagged");
    if (cell.m && (cell.o || state.over)) btn.classList.add("mine");
    if (cell.by && cell.by === state.you.id) btn.classList.add("by-me");
    if (cell.by && cell.by !== state.you.id) btn.classList.add("by-other");
    if (cell.a) btn.dataset.adj = String(cell.a);

    btn.textContent = getCellText(cell);
    wireCellButton(btn, cell.i, modal);
    container.appendChild(btn);
  });
}

function wireCellButton(btn, cellIndex, modal) {
  btn.addEventListener("mouseenter", () => {
    sendHoverCell(cellIndex);
  });

  btn.addEventListener("click", (e) => {
    if (Date.now() < (btn._ignoreClickUntil || 0)) {
      e.preventDefault();
      return;
    }
    if (state?.over) return;
    handlePrimaryAction(cellIndex);
  });

  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state?.over) return;
    toggleFlag(cellIndex);
  });

  btn.addEventListener(
    "touchstart",
    (e) => {
      if (state?.over) return;
      if (e.touches.length > 1) return;

      e.preventDefault();
      sendHoverCell(cellIndex);

      const touch = e.touches[0];
      btn._touchStartX = touch.clientX;
      btn._touchStartY = touch.clientY;
      btn._startScrollLeft = els.modalBoardScroll.scrollLeft;
      btn._startScrollTop = els.modalBoardScroll.scrollTop;
      btn._dragging = false;
      btn._longPressTriggered = false;

      clearButtonTouchTimer(btn);

      const timer = setTimeout(() => {
        activeTouchTimers.delete(timer);
        btn._touchTimer = null;

        if (pinchGesture || btn._dragging || state?.over) return;

        btn._longPressTriggered = true;
        btn._ignoreClickUntil = Date.now() + 500;
        toggleFlag(cellIndex);
        impact("medium");
      }, LONG_PRESS_MS);

      btn._touchTimer = timer;
      activeTouchTimers.add(timer);
    },
    { passive: false }
  );

  btn.addEventListener(
    "touchmove",
    (e) => {
      if (pinchGesture || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const dx = touch.clientX - (btn._touchStartX || touch.clientX);
      const dy = touch.clientY - (btn._touchStartY || touch.clientY);

      if (modal && (btn._dragging || Math.hypot(dx, dy) > DRAG_THRESHOLD)) {
        btn._dragging = true;
        clearButtonTouchTimer(btn);
        btn._ignoreClickUntil = Date.now() + 500;
        els.modalBoardScroll.scrollLeft = (btn._startScrollLeft || 0) - dx;
        els.modalBoardScroll.scrollTop = (btn._startScrollTop || 0) - dy;
        e.preventDefault();
      }
    },
    { passive: false }
  );

  btn.addEventListener(
    "touchend",
    (e) => {
      clearHoverCell();

      if (btn._dragging) {
        clearButtonTouchTimer(btn);
        btn._ignoreClickUntil = Date.now() + 500;
        e.preventDefault();
        return;
      }

      if (btn._longPressTriggered) {
        btn._ignoreClickUntil = Date.now() + 500;
        e.preventDefault();
        return;
      }

      clearButtonTouchTimer(btn);
      btn._ignoreClickUntil = Date.now() + 500;

      if (!state?.over && !pinchGesture) {
        handlePrimaryAction(cellIndex);
      }
      e.preventDefault();
    },
    { passive: false }
  );

  btn.addEventListener("touchcancel", () => {
    clearButtonTouchTimer(btn);
    clearHoverCell();
  });
}

function clearButtonTouchTimer(btn) {
  if (!btn?._touchTimer) return;
  clearTimeout(btn._touchTimer);
  activeTouchTimers.delete(btn._touchTimer);
  btn._touchTimer = null;
}

function cancelAllTouchTimers() {
  activeTouchTimers.forEach((timer) => clearTimeout(timer));
  activeTouchTimers.clear();
}

function handlePrimaryAction(cellIndex) {
  if (!state || state.over) return;
  if (inputMode === "flag") {
    toggleFlag(cellIndex);
  } else {
    openCell(cellIndex);
  }
}

function openCell(cellIndex) {
  send({ type: "reveal", cell: cellIndex });
}

function toggleFlag(cellIndex) {
  send({ type: "toggle_flag", cell: cellIndex });
}

function sendHoverCell(cellIndex) {
  if (!state?.online || state.over) return;
  if (lastHoverCell === cellIndex) return;
  lastHoverCell = cellIndex;
  send({ type: "hover", cell: cellIndex });
}

function clearHoverCell(silent = false) {
  if (lastHoverCell === null) return;
  lastHoverCell = null;
  if (!silent && state?.online && !state.over) {
    send({ type: "hover", cell: -1 });
  }
}

function handleModalGestureStart(e) {
  if (e.touches.length === 2) {
    cancelAllTouchTimers();
    pinchGesture = {
      startDistance: touchesDistance(e.touches[0], e.touches[1]),
      startZoom: boardZoom,
    };
    e.preventDefault();
  }
}

function handleModalGestureMove(e) {
  if (e.touches.length !== 2) return;
  if (!pinchGesture) {
    pinchGesture = {
      startDistance: touchesDistance(e.touches[0], e.touches[1]),
      startZoom: boardZoom,
    };
  }

  const rect = els.modalBoardScroll.getBoundingClientRect();
  const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
  const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
  const distance = touchesDistance(e.touches[0], e.touches[1]);
  const nextZoom = clamp(
    pinchGesture.startZoom * (distance / Math.max(1, pinchGesture.startDistance)),
    ZOOM_MIN,
    ZOOM_MAX
  );

  zoomKeepingViewport(nextZoom, { x: centerX, y: centerY });
  e.preventDefault();
}

function handleModalGestureEnd(e) {
  if (e.touches.length < 2) {
    pinchGesture = null;
  }
}

function touchesDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function zoomKeepingViewport(nextZoom, anchor = null) {
  if (!state) return;

  const scroll = els.modalBoardScroll;
  const rect = scroll.getBoundingClientRect();
  const oldZoom = boardZoom;

  if (Math.abs(nextZoom - oldZoom) < 0.001) return;

  const anchorX = anchor?.x ?? rect.width / 2;
  const anchorY = anchor?.y ?? rect.height / 2;
  const contentX = scroll.scrollLeft + anchorX;
  const contentY = scroll.scrollTop + anchorY;
  const ratio = nextZoom / oldZoom;

  boardZoom = nextZoom;
  renderBoards();

  requestAnimationFrame(() => {
    scroll.scrollLeft = Math.max(0, contentX * ratio - anchorX);
    scroll.scrollTop = Math.max(0, contentY * ratio - anchorY);
  });
}

function renderOverlay() {
  const over = !!state?.over;

  if (!over) {
    els.overlay.classList.add("hidden");
    els.modalRestartBtn.classList.add("hidden");
    return;
  }

  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = state.status || "Раунд завершён";
  els.overlayActionBtn.textContent = state.online ? "Рестарт комнаты" : "Сыграть ещё";

  els.modalRestartBtn.classList.remove("hidden");
  els.modalRestartBtn.textContent = state.online ? "Рестарт комнаты" : "Сыграть ещё";
}

function updateTopCounters() {
  const minesLeft = state?.flagsLeft ?? getMines();
  const elapsed = state?.over ? frozenElapsedSec : computeElapsedSec(state);
  const timeText = formatDuration(elapsed);

  els.flagsValue.textContent = String(minesLeft);
  els.topMinesValue.textContent = String(minesLeft);
  els.modalMinesValue.textContent = String(minesLeft);

  els.sidebarTimerValue.textContent = timeText;
  els.topTimerValue.textContent = timeText;
  els.modalTimerValue.textContent = timeText;
}

function computeElapsedSec(gameState) {
  if (!gameState?.startedAt) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.max(0, nowSec - Number(gameState.startedAt));
}

function formatDuration(totalSec) {
  const sec = Math.max(0, Number(totalSec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (h > 0) {
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function openFieldModal() {
  els.fieldModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  if (state) fitZoom();
}

function closeFieldModal() {
  els.fieldModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function fitZoom() {
  if (!state) return;

  const cols = state.cols || 9;
  const rows = state.rows || 9;
  const base = getModalBaseCellSize(cols);
  const gap = base <= 14 ? 2 : base <= 20 ? 3 : 4;

  const availW = Math.max(240, window.innerWidth - 90);
  const availH = Math.max(240, window.innerHeight - 260);

  const totalW = cols * base + Math.max(0, cols - 1) * gap;
  const totalH = rows * base + Math.max(0, rows - 1) * gap;

  const zoomW = availW / totalW;
  const zoomH = availH / totalH;

  zoomKeepingViewport(clamp(Math.min(zoomW, zoomH), ZOOM_MIN, ZOOM_MAX));
}

function defaultZoomForState(gameState) {
  if (!gameState) return 1;
  const maxSide = Math.max(gameState.rows || 0, gameState.cols || 0);
  if (maxSide >= 24) return 0.95;
  if (maxSide >= 16) return 1.05;
  if (maxSide >= 12) return 1.15;
  return 1.25;
}

function getPreviewBaseCellSize(cols) {
  const w = window.innerWidth;
  if (cols >= 24) return w < 420 ? 11 : w < 700 ? 12 : 13;
  if (cols >= 16) return w < 420 ? 13 : w < 700 ? 15 : 17;
  if (cols >= 12) return w < 420 ? 16 : w < 700 ? 18 : 22;
  return w < 420 ? 24 : 28;
}

function getModalBaseCellSize(cols) {
  const w = window.innerWidth;
  if (cols >= 24) return w < 420 ? 14 : w < 700 ? 16 : 18;
  if (cols >= 16) return w < 420 ? 18 : w < 700 ? 22 : 26;
  if (cols >= 12) return w < 420 ? 22 : w < 700 ? 26 : 30;
  return w < 420 ? 30 : 36;
}

function getCellText(cell) {
  if (cell.f && !cell.o) return "⚑";
  if (cell.m && (cell.o || state?.over)) return "✹";
  if (cell.o && cell.a > 0) return String(cell.a);
  return "";
}

function applyHoverDecorations() {
  const hovered = new Set();

  Object.entries(remoteHovers || {}).forEach(([playerId, cell]) => {
    if (playerId === state?.you?.id) return;
    if (Number.isInteger(cell) && cell >= 0) {
      hovered.add(String(cell));
    }
  });

  document.querySelectorAll(".cell[data-index]").forEach((cellEl) => {
    cellEl.classList.toggle("hovered-by-other", hovered.has(cellEl.dataset.index));
  });
}

function prettyMode(mode) {
  if (mode === "coop") return "Co-op";
  if (mode === "versus") return "Versus";
  return "Solo";
}

function getShareLink() {
  if (!state?.roomCode) return "";
  return state.shareLink || state.inviteLink || `${location.origin}/?room=${state.roomCode}`;
}

async function shareRoomLink() {
  const link = getShareLink();
  if (!link) {
    toast("Нет активной комнаты");
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "MineSprint",
        text: "Зайди в мою комнату MineSprint",
        url: link,
      });
      return;
    }
  } catch (_) {}

  try {
    await navigator.clipboard.writeText(link);
    toast("Ссылка бота скопирована");
  } catch (_) {
    toast(link);
  }
}

async function loadAdminStats() {
  if (user.id !== ADMIN_TG_ID || !tg?.initData) return;

  try {
    const res = await fetch("/api/admin/stats", {
      headers: {
        "X-Telegram-Init-Data": tg.initData,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "admin error");
    adminStats = data;
    renderAdmin();
  } catch (_) {
    els.adminSummary.innerHTML = `<div class="placeholder">Не удалось загрузить админку</div>`;
  }
}

function renderAdmin() {
  if (!adminStats) return;

  const s = adminStats.summary || {};
  const byMode = adminStats.byMode || {};
  const leaderboard = adminStats.leaderboard || [];
  const users = adminStats.users || [];
  const topUsers = adminStats.topUsers || [];
  const recent = adminStats.recentMatches || [];

  els.adminSummary.innerHTML = `
    <div class="admin-card"><span>Пользователи</span><strong>${s.totalUsers ?? 0}</strong></div>
    <div class="admin-card"><span>Активные 7д</span><strong>${s.active7d ?? 0}</strong></div>
    <div class="admin-card"><span>Матчи</span><strong>${s.totalMatches ?? 0}</strong></div>
    <div class="admin-card"><span>Ходы</span><strong>${s.totalMoves ?? 0}</strong></div>
    <div class="admin-card"><span>Live users</span><strong>${s.liveUsers ?? 0}</strong></div>
    <div class="admin-card"><span>Live rooms</span><strong>${s.liveRooms ?? 0}</strong></div>
    <div class="admin-card"><span>Solo</span><strong>${byMode.solo ?? 0}</strong></div>
    <div class="admin-card"><span>Co-op / Versus</span><strong>${(byMode.coop ?? 0) + (byMode.versus ?? 0)}</strong></div>
  `;

  els.adminLeaderboard.innerHTML = leaderboard.length
    ? leaderboard
        .map((item, index) => {
          return `
            <div class="admin-item">
              <div class="admin-item-top">
                <strong>#${index + 1} ${escapeHtml(item.name)}</strong>
                <span>${item.wins} побед</span>
              </div>
              <div class="admin-meta">Игры: ${item.games} · Co-op wins: ${item.coopWins} · Versus wins: ${item.versusWins} · Очки: ${item.totalScore}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="placeholder">Нет данных</div>`;

  els.adminUsers.innerHTML = users.length
    ? users
        .map((item) => {
          return `
            <div class="admin-item">
              <div class="admin-item-top">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${item.banned ? "Забанен" : "Активен"}</span>
              </div>
              <div class="admin-meta">Игры: ${item.games} · Победы: ${item.wins} · Очки: ${item.totalScore}</div>
              <div class="admin-actions">
                ${
                  item.id === ADMIN_TG_ID
                    ? ""
                    : item.banned
                    ? `<button class="ban-btn unban" data-unban-user="${item.id}">Разбанить</button>`
                    : `<button class="ban-btn ban" data-ban-user="${item.id}">Забанить</button>`
                }
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="placeholder">Нет данных</div>`;

  els.adminTopUsers.innerHTML = topUsers.length
    ? topUsers
        .map((item) => {
          return `
            <div class="admin-item">
              <div class="admin-item-top">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${item.banned ? "Забанен" : item.games + " игр"}</span>
              </div>
              <div class="admin-meta">Победы: ${item.wins} · Очки: ${item.totalScore}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="placeholder">Нет данных</div>`;

  els.adminRecentMatches.innerHTML = recent.length
    ? recent
        .map((item) => {
          return `
            <div class="admin-item">
              <div class="admin-item-top">
                <strong>${escapeHtml(prettyMode(item.mode))}</strong>
                <span>${item.rows}×${item.cols}</span>
              </div>
              <div class="admin-meta">${item.mines} мин · ${escapeHtml(item.players || "")}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="placeholder">Нет данных</div>`;

  bindAdminButtons();
}

function bindAdminButtons() {
  document.querySelectorAll("[data-ban-user]").forEach((btn) => {
    btn.onclick = async () => {
      await setBan(btn.dataset.banUser, true);
    };
  });

  document.querySelectorAll("[data-unban-user]").forEach((btn) => {
    btn.onclick = async () => {
      await setBan(btn.dataset.unbanUser, false);
    };
  });
}

async function setBan(userId, banned) {
  if (!userId) return;

  const endpoint = banned ? "/api/admin/ban" : "/api/admin/unban";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData,
      },
      body: JSON.stringify({
        userId,
        reason: banned ? "banned by admin" : "",
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");

    toast(banned ? "Игрок забанен" : "Игрок разбанен");
    await loadAdminStats();
  } catch (e) {
    toast(e.message || "Ошибка");
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

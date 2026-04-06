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
  modalStage: $("#modalStage"),
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
let remoteHovers = {};
let lastHoverCell = null;
let frozenElapsedSec = 0;

let modalScale = 1;
let modalOffsetX = 0;
let modalOffsetY = 0;
let panGesture = null;
let pinchGesture = null;
let mousePan = null;
let suppressTapUntil = 0;

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
      els.rowsInput.value = String(rows);
      els.colsInput.value = String(cols);
      els.minesInput.value = String(mines);
      renderStats();
    });
  });

  [els.rowsInput, els.colsInput, els.minesInput].forEach((input) => {
    input.addEventListener("input", () => {
      sanitizeNumericInput(input);
      renderStats();
    });
    input.addEventListener("blur", () => {
      normalizeInputs();
      renderStats();
    });
    input.addEventListener("focus", () => {
      input.select?.();
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
    zoomKeepingViewport(clamp(modalScale + 0.15, ZOOM_MIN, ZOOM_MAX));
  });

  els.zoomOutBtn.addEventListener("click", () => {
    zoomKeepingViewport(clamp(modalScale - 0.15, ZOOM_MIN, ZOOM_MAX));
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

  els.modalBoardScroll.addEventListener("mousedown", handleMousePanStart);
  window.addEventListener("mousemove", handleMousePanMove);
  window.addEventListener("mouseup", handleMousePanEnd);

  els.modalBoardScroll.addEventListener("contextmenu", (e) => e.preventDefault());
  els.boardModal.addEventListener("contextmenu", (e) => e.preventDefault());
  els.boardPreview.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    renderBoards();
    updateTopCounters();
  });
}

function sanitizeNumericInput(input) {
  input.value = String(input.value || "").replace(/[^\d]/g, "");
}

function getInputPreviewValue(input, fallback) {
  const raw = String(input.value || "").trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
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
  els.rowsInput.value = String(preset.rows);
  els.colsInput.value = String(preset.cols);
  els.minesInput.value = String(preset.mines);
}

function normalizeInputs() {
  let rows = getInputPreviewValue(els.rowsInput, 9);
  let cols = getInputPreviewValue(els.colsInput, 9);

  rows = clamp(rows, 5, 30);
  cols = clamp(cols, 5, 30);

  const maxMines = Math.max(1, rows * cols - 1);
  let mines = getInputPreviewValue(els.minesInput, Math.min(10, maxMines));
  mines = clamp(mines, 1, maxMines);

  els.rowsInput.value = String(rows);
  els.colsInput.value = String(cols);
  els.minesInput.value = String(mines);
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
      modalScale = defaultZoomForState(state);
      modalOffsetX = 0;
      modalOffsetY = 0;
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
  const rows = state?.rows || getInputPreviewValue(els.rowsInput, 9);
  const cols = state?.cols || getInputPreviewValue(els.colsInput, 9);
  const previewMaxMines = Math.max(1, rows * cols - 1);
  const mines = state?.mines || clamp(getInputPreviewValue(els.minesInput, 10), 1, previewMaxMines);

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

  requestAnimationFrame(() => {
    clampModalTransform();
    applyModalTransform();
    applyHoverDecorations();
  });
}

function renderBoardTo(container, modal) {
  if (!state) {
    container.innerHTML = `<div class="empty-state">Выбери режим и начни игру</div>`;
    return;
  }

  const cols = state.cols || 9;
  const cellSize = modal ? getModalBaseCellSize(cols) : getPreviewBaseCellSize(cols);
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
    wireCellButton(btn, cell.i);
    container.appendChild(btn);
  });
}

function wireCellButton(btn, cellIndex) {
  btn.addEventListener("mouseenter", () => {
    sendHoverCell(cellIndex);
  });

  btn.addEventListener("click", (e) => {
    if (Date.now() < suppressTapUntil || Date.now() < (btn._ignoreClickUntil || 0)) {
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
      btn._longPressTriggered = false;
      clearButtonTouchTimer(btn);

      const timer = setTimeout(() => {
        activeTouchTimers.delete(timer);
        btn._touchTimer = null;

        if (pinchGesture || (panGesture && panGesture.active) || state?.over) return;

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
    "touchend",
    (e) => {
      clearHoverCell();

      if (btn._longPressTriggered || Date.now() < suppressTapUntil || pinchGesture) {
        clearButtonTouchTimer(btn);
        btn._ignoreClickUntil = Date.now() + 500;
        e.preventDefault();
        return;
      }

      clearButtonTouchTimer(btn);
      btn._ignoreClickUntil = Date.now() + 500;

      if (!state?.over) {
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
  if (!state || els.fieldModal.classList.contains("hidden")) return;

  if (e.touches.length === 2) {
    cancelAllTouchTimers();
    const rect = els.modalBoardScroll.getBoundingClientRect();
    const centerX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
    const centerY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;

    pinchGesture = {
      startDistance: touchesDistance(e.touches[0], e.touches[1]),
      startScale: modalScale,
      boardX: (centerX - modalOffsetX) / modalScale,
      boardY: (centerY - modalOffsetY) / modalScale,
    };

    panGesture = null;
    suppressTapUntil = Date.now() + 300;
    e.preventDefault();
    return;
  }

  if (e.touches.length === 1 && !pinchGesture) {
    const touch = e.touches[0];
    panGesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      startOffsetX: modalOffsetX,
      startOffsetY: modalOffsetY,
      active: false,
    };
    e.preventDefault();
  }
}

function handleModalGestureMove(e) {
  if (!state || els.fieldModal.classList.contains("hidden")) return;

  if (e.touches.length === 2) {
    if (!pinchGesture) {
      const rect = els.modalBoardScroll.getBoundingClientRect();
      const centerX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
      const centerY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;

      pinchGesture = {
        startDistance: touchesDistance(e.touches[0], e.touches[1]),
        startScale: modalScale,
        boardX: (centerX - modalOffsetX) / modalScale,
        boardY: (centerY - modalOffsetY) / modalScale,
      };
    }

    cancelAllTouchTimers();

    const rect = els.modalBoardScroll.getBoundingClientRect();
    const centerX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
    const centerY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
    const distance = touchesDistance(e.touches[0], e.touches[1]);
    const nextScale = clamp(
      pinchGesture.startScale * (distance / Math.max(1, pinchGesture.startDistance)),
      ZOOM_MIN,
      ZOOM_MAX
    );

    modalScale = nextScale;
    modalOffsetX = centerX - pinchGesture.boardX * modalScale;
    modalOffsetY = centerY - pinchGesture.boardY * modalScale;
    clampModalTransform();
    applyModalTransform();

    suppressTapUntil = Date.now() + 300;
    e.preventDefault();
    return;
  }

  if (e.touches.length === 1 && panGesture && !pinchGesture) {
    const touch = e.touches[0];
    const dx = touch.clientX - panGesture.startX;
    const dy = touch.clientY - panGesture.startY;

    if (!panGesture.active && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      panGesture.active = true;
      cancelAllTouchTimers();
      suppressTapUntil = Date.now() + 300;
    }

    if (panGesture.active) {
      modalOffsetX = panGesture.startOffsetX + dx;
      modalOffsetY = panGesture.startOffsetY + dy;
      clampModalTransform();
      applyModalTransform();
      e.preventDefault();
    }
  }
}

function handleModalGestureEnd(e) {
  if (e.touches.length === 0) {
    if ((panGesture && panGesture.active) || pinchGesture) {
      suppressTapUntil = Date.now() + 250;
    }
    panGesture = null;
    pinchGesture = null;
    return;
  }

  if (e.touches.length === 1 && pinchGesture) {
    pinchGesture = null;
    const touch = e.touches[0];
    panGesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      startOffsetX: modalOffsetX,
      startOffsetY: modalOffsetY,
      active: false,
    };
    suppressTapUntil = Date.now() + 250;
  }
}

function handleMousePanStart(e) {
  if (!state || els.fieldModal.classList.contains("hidden")) return;
  if (e.button !== 0) return;
  if (!e.target.closest(".board")) return;

  mousePan = {
    startX: e.clientX,
    startY: e.clientY,
    startOffsetX: modalOffsetX,
    startOffsetY: modalOffsetY,
    active: false,
  };
}

function handleMousePanMove(e) {
  if (!mousePan || !state) return;

  const dx = e.clientX - mousePan.startX;
  const dy = e.clientY - mousePan.startY;

  if (!mousePan.active && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    mousePan.active = true;
    suppressTapUntil = Date.now() + 250;
  }

  if (mousePan.active) {
    modalOffsetX = mousePan.startOffsetX + dx;
    modalOffsetY = mousePan.startOffsetY + dy;
    clampModalTransform();
    applyModalTransform();
  }
}

function handleMousePanEnd() {
  if (mousePan?.active) {
    suppressTapUntil = Date.now() + 250;
  }
  mousePan = null;
}

function touchesDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function zoomKeepingViewport(nextScale, anchor = null) {
  if (!state) return;

  const rect = els.modalBoardScroll.getBoundingClientRect();
  const anchorX = anchor?.x ?? rect.width / 2;
  const anchorY = anchor?.y ?? rect.height / 2;

  const boardX = (anchorX - modalOffsetX) / modalScale;
  const boardY = (anchorY - modalOffsetY) / modalScale;

  modalScale = nextScale;
  modalOffsetX = anchorX - boardX * modalScale;
  modalOffsetY = anchorY - boardY * modalScale;

  clampModalTransform();
  applyModalTransform();
}

function clampModalTransform() {
  if (!els.modalStage || !state) return;

  const viewportW = els.modalBoardScroll.clientWidth;
  const viewportH = els.modalBoardScroll.clientHeight;
  const contentW = els.modalStage.offsetWidth * modalScale;
  const contentH = els.modalStage.offsetHeight * modalScale;

  if (contentW <= viewportW) {
    modalOffsetX = (viewportW - contentW) / 2;
  } else {
    modalOffsetX = clamp(modalOffsetX, viewportW - contentW, 0);
  }

  if (contentH <= viewportH) {
    modalOffsetY = (viewportH - contentH) / 2;
  } else {
    modalOffsetY = clamp(modalOffsetY, viewportH - contentH, 0);
  }
}

function applyModalTransform() {
  if (!els.modalStage) return;
  els.modalStage.style.transform = `translate3d(${modalOffsetX}px, ${modalOffsetY}px, 0) scale(${modalScale})`;
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
  const previewRows = getInputPreviewValue(els.rowsInput, 9);
  const previewCols = getInputPreviewValue(els.colsInput, 9);
  const previewMaxMines = Math.max(1, previewRows * previewCols - 1);
  const previewMines = clamp(getInputPreviewValue(els.minesInput, 10), 1, previewMaxMines);

  const minesLeft = state?.flagsLeft ?? previewMines;
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
  requestAnimationFrame(() => {
    if (state) fitZoom();
  });
}

function closeFieldModal() {
  els.fieldModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function fitZoom() {
  if (!state || !els.modalStage) return;

  const viewportW = Math.max(240, els.modalBoardScroll.clientWidth);
  const viewportH = Math.max(240, els.modalBoardScroll.clientHeight);
  const contentW = Math.max(1, els.modalStage.offsetWidth);
  const contentH = Math.max(1, els.modalStage.offsetHeight);

  modalScale = clamp(Math.min(viewportW / contentW, viewportH / contentH), ZOOM_MIN, ZOOM_MAX);
  modalOffsetX = 0;
  modalOffsetY = 0;

  clampModalTransform();
  applyModalTransform();
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

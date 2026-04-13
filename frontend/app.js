/* frontend/app.js */
const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.("#0b1020");
tg?.setBackgroundColor?.("#0b1020");

const ADMIN_TG_ID = "887152362";
const LONG_PRESS_MS = 380;

const SHAPE_CATALOG = [
  { id: "square",  name: "Квадрат",        icon: "◼", price: 0  },
  { id: "circle",  name: "Круг",           icon: "●", price: 39 },
  { id: "diamond", name: "Ромб",           icon: "◆", price: 39 },
  { id: "cross",   name: "Крест",          icon: "✚", price: 39 },
  { id: "x_shape", name: "Икс",            icon: "✕", price: 39 },
  { id: "frame_x", name: "Рамка с иксом",  icon: "⊠", price: 39 },
];

const SKIN_CATALOG = [
  {
    id: "default",
    name: "Тёмный космос",
    price: 0,
    previewClass: "skin-preview-default",
    activeClass: "active",
    cells: ["","sp-open","sp-me","","sp-open","","sp-mine","sp-open","","sp-open","","","sp-open","sp-open","","sp-open"],
  },
  {
    id: "matrix",
    name: "Матрица",
    price: 19,
    previewClass: "skin-preview-matrix",
    activeClass: "active-matrix",
    cells: ["","sp-open","sp-me","","sp-open","","sp-mine","sp-open","","sp-open","","","sp-open","sp-open","","sp-open"],
  },
  {
    id: "sunset",
    name: "Закат",
    price: 19,
    previewClass: "skin-preview-sunset",
    activeClass: "active-sunset",
    cells: ["","sp-open","sp-me","","sp-open","","sp-mine","sp-open","","sp-open","","","sp-open","sp-open","","sp-open"],
  },
  {
    id: "ocean",
    name: "Океан",
    price: 19,
    previewClass: "skin-preview-ocean",
    activeClass: "active-ocean",
    cells: ["","sp-open","sp-me","","sp-open","","sp-mine","sp-open","","sp-open","","","sp-open","sp-open","","sp-open"],
  },
  {
    id: "neon",
    name: "Неон",
    price: 19,
    previewClass: "skin-preview-neon",
    activeClass: "active-neon",
    cells: ["","sp-open","sp-me","","sp-open","","sp-mine","sp-open","","sp-open","","","sp-open","sp-open","","sp-open"],
  },
  {
    id: "arctic",
    name: "Арктика",
    price: 19,
    previewClass: "skin-preview-arctic",
    activeClass: "active-arctic",
    cells: ["","sp-open","sp-me","","sp-open","","sp-mine","sp-open","","sp-open","","","sp-open","sp-open","","sp-open"],
  },
];
const DRAG_THRESHOLD = 10;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.8;
const SPRING_PULL = 0.32;

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
  copyCodeBtn: $("#copyCodeBtn"),
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
  openSkinsBtn: $("#openSkinsBtn"),
  closeSkinsBtn: $("#closeSkinsBtn"),
  skinsModal: $("#skinsModal"),
  skinsGrid: $("#skinsGrid"),
  zoomInBtn: $("#zoomInBtn"),
  zoomOutBtn: $("#zoomOutBtn"),
  fitZoomBtn: $("#fitZoomBtn"),
  fullscreenFieldBtn: $("#fullscreenFieldBtn"),
  reviveBtn: $("#reviveBtn"),
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

  proSection: $("#proSection"),
  proStatus: $("#proStatus"),
  buyProBtn: $("#buyProBtn"),

  adminSection: $("#adminSection"),
  openAdminBtn: $("#openAdminBtn"),
  adminModal: $("#adminModal"),
  closeAdminBtn: $("#closeAdminBtn"),
  refreshAdminBtn: $("#refreshAdminBtn"),
  adminSummary: $("#adminSummary"),
  adminPurchases: $("#adminPurchases"),
  adminLeaderboard: $("#adminLeaderboard"),
  adminUsers: $("#adminUsers"),
  adminTopUsers: $("#adminTopUsers"),
  adminRecentMatches: $("#adminRecentMatches"),

  toggleMinesCheckbox: $("#toggleMinesCheckbox"),
  minesToggleLabel: $("#minesToggleLabel"),
  toggleChordCheckbox: $("#toggleChordCheckbox"),
  fieldSizeHint: $("#fieldSizeHint"),

  toast: $("#toast"),
  boardCard: document.querySelector(".board-card"),
};

let modeButtons = [];
let inputButtons = [];
let resizeTimer = null;
let prevHoveredIndices = new Set();
const cellTouchTimers = new Map();
const cellLongPressed = new Map();
const cellIgnoreClickUntil = new Map();

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
let activeSkinId = "default";
let ownedSkins = ["default"];
let skinPurchasePending = null; // skinId being purchased
let selectedShape = "square";
let ownedShapes = [];
let shapePurchasePending = null; // shapeId being purchased
let hasSubscription = false;
let isPrivileged = false;
let isAdmin = false;
let subPurchasePending = false;

let showMineCounter = true;
let chordEnabled = true;

let modalScale = 1;
let modalOffsetX = 0;
let modalOffsetY = 0;
let cleanFullscreenMode = false;
let revivePending = false;
let panGesture = null;
let pinchGesture = null;
let mousePan = null;
let suppressTapUntil = 0;
let springFrame = 0;

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
  modeButtons = [...document.querySelectorAll("[data-mode]")];
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMode = btn.dataset.mode;
      applyPresetIfNeeded();
      renderBase();
    });
  });

  inputButtons = [...document.querySelectorAll("[data-input]")];
  inputButtons.forEach((btn) => {
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
      shape: selectedShape,
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
      shape: selectedShape,
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
  els.copyCodeBtn.addEventListener("click", copyRoomCode);
  els.leaveRoomBtn.addEventListener("click", () => send({ type: "leave_room" }));
  els.restartRoomBtn.addEventListener("click", restartCurrentGame);
  els.overlayActionBtn.addEventListener("click", restartCurrentGame);
  els.modalRestartBtn.addEventListener("click", restartCurrentGame);

  els.reviveBtn.addEventListener("click", () => {
    if (!state?.canRevive || revivePending) return;
    revivePending = true;
    els.reviveBtn.disabled = true;
    send({ type: "revive_request" });
  });

  els.openFieldBtn.addEventListener("click", openFieldModal);
  els.closeFieldBtn.addEventListener("click", closeFieldModal);
  els.openSkinsBtn.addEventListener("click", openSkinsModal);
  els.closeSkinsBtn.addEventListener("click", closeSkinsModal);
  els.skinsModal.addEventListener("click", (e) => {
    if (e.target === els.skinsModal) closeSkinsModal();
  });

  els.zoomInBtn.addEventListener("click", () => {
    zoomKeepingViewport(clamp(modalScale + 0.15, ZOOM_MIN, ZOOM_MAX));
  });

  els.zoomOutBtn.addEventListener("click", () => {
    zoomKeepingViewport(clamp(modalScale - 0.15, ZOOM_MIN, ZOOM_MAX));
  });

  els.fitZoomBtn.addEventListener("click", fitZoom);

  els.fullscreenFieldBtn.addEventListener("click", () => {
    cleanFullscreenMode = !cleanFullscreenMode;
    applyFullscreenMode();
    requestAnimationFrame(() => {
      clampToBoundsImmediate();
      applyModalTransform();
    });
  });


  els.buyProBtn.addEventListener("click", () => {
    if (subPurchasePending || hasSubscription || isPrivileged || isAdmin) return;
    subPurchasePending = true;
    els.buyProBtn.disabled = true;
    send({ type: "subscribe_request" });
    impact("medium");
  });

  els.toggleMinesCheckbox.addEventListener("change", () => {
    showMineCounter = els.toggleMinesCheckbox.checked;
    document.body.classList.toggle("hide-mines", !showMineCounter);
  });

  els.toggleChordCheckbox.addEventListener("change", () => {
    chordEnabled = els.toggleChordCheckbox.checked;
  });

  els.openAdminBtn.addEventListener("click", openAdminModal);
  els.closeAdminBtn.addEventListener("click", closeAdminModal);
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

  els.modalBoardScroll.addEventListener("wheel", handleWheelZoom, { passive: false });

  els.modalBoardScroll.addEventListener("contextmenu", (e) => e.preventDefault());
  els.boardModal.addEventListener("contextmenu", (e) => e.preventDefault());
  els.boardPreview.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderBoards();
      updateTopCounters();
    }, 200);
  });

  setupBoardDelegation(els.boardPreview);
  setupBoardDelegation(els.boardModal);
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
}

function restartCurrentGame() {
  indicateGameAction("Перезапускаем...");
  if (state?.online) {
    send({ type: "restart_room", rows: getRows(), cols: getCols(), mines: getMines(), shape: selectedShape });
  } else {
    send({
      type: "start_solo",
      rows: state?.rows || getRows(),
      cols: state?.cols || getCols(),
      mines: state?.mines || getMines(),
      shape: selectedShape,
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

function getMaxFieldSize() {
  return (hasSubscription || isPrivileged || isAdmin || user.id === ADMIN_TG_ID) ? 50 : 30;
}

function normalizeInputs() {
  const maxSize = getMaxFieldSize();
  let rows = getInputPreviewValue(els.rowsInput, 9);
  let cols = getInputPreviewValue(els.colsInput, 9);

  rows = clamp(rows, 5, maxSize);
  cols = clamp(cols, 5, maxSize);

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
    if (msg.activeSkin) {
      activeSkinId = msg.activeSkin;
      applySkin(activeSkinId);
    }
    if (Array.isArray(msg.ownedSkins)) {
      ownedSkins = msg.ownedSkins;
    }
    if (Array.isArray(msg.ownedShapes)) {
      ownedShapes = msg.ownedShapes;
    }
    hasSubscription = !!msg.hasSubscription;
    isPrivileged = !!msg.isPrivileged;
    isAdmin = !!msg.isAdmin;
    renderProStatus();
    renderShapeSelector();
    if (isAdmin) {
      els.adminSection.classList.remove("hidden");
      loadAdminStats();
    }
    return;
  }

  if (msg.type === "subscription_activated") {
    hasSubscription = true;
    subPurchasePending = false;
    renderProStatus();
    toast("Pro подписка активирована! До 10 игроков в Co-op.");
    impact("medium");
    return;
  }

  if (msg.type === "privilege_granted") {
    isPrivileged = true;
    renderProStatus();
    toast("Вам выдан безлимитный доступ администратором.");
    impact("medium");
    return;
  }

  if (msg.type === "privilege_revoked") {
    isPrivileged = false;
    renderProStatus();
    toast("Безлимитный доступ отозван.");
    return;
  }

  if (msg.type === "shape_purchased") {
    if (Array.isArray(msg.ownedShapes)) {
      ownedShapes = msg.ownedShapes;
    }
    shapePurchasePending = null;
    renderShapeSelector();
    toast("Форма куплена!");
    impact("medium");
    return;
  }

  if (msg.type === "shape_revoked") {
    if (Array.isArray(msg.ownedShapes)) {
      ownedShapes = msg.ownedShapes;
    }
    if (msg.shapeId && selectedShape === msg.shapeId) {
      selectedShape = "square";
    }
    renderShapeSelector();
    return;
  }

  if (msg.type === "skin_selected" || msg.type === "skin_purchased") {
    if (msg.activeSkin) {
      activeSkinId = msg.activeSkin;
      applySkin(activeSkinId);
    }
    if (Array.isArray(msg.ownedSkins)) {
      ownedSkins = msg.ownedSkins;
    }
    skinPurchasePending = null;
    renderSkinsGrid();
    if (msg.type === "skin_purchased") {
      toast("Скин куплен и применён!");
      impact("medium");
    }
    return;
  }

  if (msg.type === "skin_revoked") {
    if (Array.isArray(msg.ownedSkins)) {
      ownedSkins = msg.ownedSkins;
    }
    if (msg.activeSkin) {
      activeSkinId = msg.activeSkin;
      applySkin(activeSkinId);
    }
    skinPurchasePending = null;
    renderSkinsGrid();
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
    if (state.shape) selectedShape = state.shape;
    remoteHovers = { ...(state.hovers || {}) };
    clearHoverCell(true);

    // Sync skin from state (may include ownedSkins on first state after purchase)
    if (state.activeSkin && state.activeSkin !== activeSkinId) {
      activeSkinId = state.activeSkin;
      applySkin(activeSkinId);
    }
    if (Array.isArray(state.ownedSkins) && state.ownedSkins.length > ownedSkins.length) {
      ownedSkins = state.ownedSkins;
    }

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
      if (isAdmin) loadAdminStats();
      if (state.won) {
        tg?.HapticFeedback?.notificationOccurred?.("success");
      } else {
        tg?.HapticFeedback?.notificationOccurred?.("warning");
      }
    }
    return;
  }

  if (msg.type === "invoice_link") {
    if (!msg.url) {
      revivePending = false;
      skinPurchasePending = null;
      subPurchasePending = false;
      if (els.reviveBtn) els.reviveBtn.disabled = false;
      renderSkinsGrid();
      renderProStatus();
      toast("Ошибка создания платежа");
      return;
    }
    tg?.openInvoice?.(msg.url, (status) => {
      if (msg.shapeId) {
        // Shape purchase flow
        if (status !== "paid") {
          shapePurchasePending = null;
          renderShapeSelector();
        }
        // If "paid" — wait for server shape_purchased message
      } else if (msg.skinId) {
        // Skin purchase flow
        if (status !== "paid") {
          skinPurchasePending = null;
          renderSkinsGrid();
        }
        // If "paid" — wait for server skin_purchased message
      } else if (msg.subPending) {
        // Subscription flow
        subPurchasePending = false;
        if (status !== "paid") {
          renderProStatus(); // re-enable button
        }
        // If "paid" — wait for server subscription_activated message
      } else {
        // Revive flow
        revivePending = false;
        if (status !== "paid") {
          if (els.reviveBtn) els.reviveBtn.disabled = false;
        }
      }
    });
    return;
  }

  if (msg.type === "error") {
    revivePending = false;
    skinPurchasePending = null;
    shapePurchasePending = null;
    if (els.reviveBtn) els.reviveBtn.disabled = false;
    renderSkinsGrid();
    renderShapeSelector();
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
  renderShapeSelector();
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
  modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === selectedMode);
  });

  inputButtons.forEach((btn) => {
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

  const gameActive = !!(state && !state.over);
  if (els.toggleMinesCheckbox) {
    els.toggleMinesCheckbox.disabled = gameActive;
  }
  if (els.minesToggleLabel) {
    els.minesToggleLabel.classList.toggle("disabled-label", gameActive);
    els.minesToggleLabel.title = gameActive
      ? "Нельзя изменить во время игры — только перед стартом или рестартом"
      : "Показывать счётчик мин — применяется при старте или рестарте";
  }
}

function renderStatus() {
  if (state?.status) {
    setStatus(state.status);
  } else if (isTelegramReady()) {
    setStatus("Выбери режим и начни игру");
  }
}

function renderProStatus() {
  if (!els.proStatus || !els.buyProBtn) return;
  if (isAdmin) {
    els.proStatus.innerHTML =
      `<strong>Безлимитный доступ</strong> — администратор<br>` +
      `<span class="pro-perks">Поля до 50×50 · Co-op до 10 игроков</span>`;
    els.proStatus.className = "pro-status pro-active";
    els.buyProBtn.classList.add("hidden");
  } else if (isPrivileged) {
    els.proStatus.innerHTML =
      `<strong>Безлимитный доступ</strong> — выдан администратором<br>` +
      `<span class="pro-perks">Поля до 50×50 · Co-op до 10 игроков</span>`;
    els.proStatus.className = "pro-status pro-active";
    els.buyProBtn.classList.add("hidden");
  } else if (hasSubscription) {
    els.proStatus.innerHTML =
      `<strong>Pro активна</strong><br>` +
      `<span class="pro-perks">Поля до 50×50 · Co-op до 10 игроков</span>`;
    els.proStatus.className = "pro-status pro-active";
    els.buyProBtn.classList.add("hidden");
  } else {
    els.proStatus.innerHTML =
      `<strong>Обычный доступ</strong><br>` +
      `<span class="pro-perks">Поля до 30×30 · Co-op до 3 игроков</span>`;
    els.proStatus.className = "pro-status";
    els.buyProBtn.classList.remove("hidden");
    els.buyProBtn.disabled = subPurchasePending;
  }
  updateFieldSizeHint();
}

function updateFieldSizeHint() {
  if (!els.fieldSizeHint) return;
  const hasAccess = isAdmin || isPrivileged || hasSubscription || user.id === ADMIN_TG_ID;
  els.fieldSizeHint.classList.toggle("hidden", hasAccess);
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

    const skinId = player.skinId || "default";
    div.innerHTML = `
      <div class="player-row">
        <div class="player-main">
          <div class="player-name" style="display:flex;align-items:center;gap:6px;">
            <span class="player-skin-dot" data-skin="${escapeHtml(skinId)}"></span>
            ${escapeHtml(player.name)}
          </div>
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
    clampToBoundsImmediate();
    applyModalTransform();
    applyPerformanceMode();
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

    if (cell.d) {
      btn.classList.add("cell-inactive");
      btn.tabIndex = -1;
      container.appendChild(btn);
      return;
    }

    if (cell.o) btn.classList.add("open");
    if (cell.f && !cell.o) btn.classList.add("flagged");
    if (cell.m && (cell.o || state.over)) btn.classList.add("mine");
    if (cell.by && cell.by === state.you.id) btn.classList.add("by-me");
    if (cell.by && cell.by !== state.you.id) btn.classList.add("by-other");
    if (cell.a) btn.dataset.adj = String(cell.a);

    btn.textContent = getCellText(cell);
    container.appendChild(btn);
  });
}

function setupBoardDelegation(container) {
  container.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".cell[data-index]");
    if (!btn || btn.classList.contains("cell-inactive")) return;
    sendHoverCell(Number(btn.dataset.index));
  });

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".cell[data-index]");
    if (!btn || btn.classList.contains("cell-inactive")) return;
    const idx = Number(btn.dataset.index);
    if (Date.now() < suppressTapUntil || Date.now() < (cellIgnoreClickUntil.get(idx) || 0)) {
      e.preventDefault();
      return;
    }
    if (state?.over) return;
    handlePrimaryAction(idx);
  });

  container.addEventListener("contextmenu", (e) => {
    const btn = e.target.closest(".cell[data-index]");
    if (!btn || btn.classList.contains("cell-inactive")) return;
    e.preventDefault();
    if (state?.over) return;
    toggleFlag(Number(btn.dataset.index));
  });

  container.addEventListener(
    "touchstart",
    (e) => {
      const btn = e.target.closest(".cell[data-index]");
      if (!btn || btn.classList.contains("cell-inactive")) return;
      if (state?.over) return;
      if (e.touches.length > 1) return;

      e.preventDefault();
      const idx = Number(btn.dataset.index);
      sendHoverCell(idx);
      cellLongPressed.set(idx, false);
      clearCellTouchTimer(idx);

      const timer = setTimeout(() => {
        activeTouchTimers.delete(timer);
        cellTouchTimers.delete(idx);

        if (pinchGesture || (panGesture && panGesture.active) || state?.over) return;

        cellLongPressed.set(idx, true);
        cellIgnoreClickUntil.set(idx, Date.now() + 500);
        toggleFlag(idx);
        impact("medium");
      }, LONG_PRESS_MS);

      cellTouchTimers.set(idx, timer);
      activeTouchTimers.add(timer);
    },
    { passive: false }
  );

  container.addEventListener(
    "touchend",
    (e) => {
      const btn = e.target.closest(".cell[data-index]");
      if (!btn || btn.classList.contains("cell-inactive")) return;
      const idx = Number(btn.dataset.index);

      clearHoverCell();

      if (cellLongPressed.get(idx) || Date.now() < suppressTapUntil || pinchGesture || (panGesture && panGesture.active)) {
        clearCellTouchTimer(idx);
        cellIgnoreClickUntil.set(idx, Date.now() + 500);
        e.preventDefault();
        return;
      }

      clearCellTouchTimer(idx);
      cellIgnoreClickUntil.set(idx, Date.now() + 500);

      if (!state?.over) {
        handlePrimaryAction(idx);
      }
      e.preventDefault();
    },
    { passive: false }
  );

  container.addEventListener("touchcancel", (e) => {
    const btn = e.target.closest(".cell[data-index]");
    if (!btn) return;
    clearCellTouchTimer(Number(btn.dataset.index));
    clearHoverCell();
  });
}

function clearCellTouchTimer(idx) {
  const timer = cellTouchTimers.get(idx);
  if (!timer) return;
  clearTimeout(timer);
  activeTouchTimers.delete(timer);
  cellTouchTimers.delete(idx);
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
  if (!chordEnabled) {
    const cell = state?.board?.[cellIndex];
    if (cell?.o && !cell?.m && (cell?.a ?? 0) > 0) return;
  }
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

  cancelSpring();

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
    setDragging(true);
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
    setDragging(true);

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

    const rawX = centerX - pinchGesture.boardX * modalScale;
    const rawY = centerY - pinchGesture.boardY * modalScale;

    setOffsetsWithElastic(rawX, rawY);
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
      setDragging(true);
      suppressTapUntil = Date.now() + 300;
    }

    if (panGesture.active) {
      const rawX = panGesture.startOffsetX + dx;
      const rawY = panGesture.startOffsetY + dy;
      setOffsetsWithElastic(rawX, rawY);
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
    setDragging(false);
    springBackToBounds();
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
    setDragging(true);
  }
}

function handleMousePanStart(e) {
  if (!state || els.fieldModal.classList.contains("hidden")) return;
  if (e.button !== 0) return;
  if (!e.target.closest(".board")) return;

  cancelSpring();

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
    setDragging(true);
  }

  if (mousePan.active) {
    const rawX = mousePan.startOffsetX + dx;
    const rawY = mousePan.startOffsetY + dy;
    setOffsetsWithElastic(rawX, rawY);
  }
}

function handleMousePanEnd() {
  if (mousePan?.active) {
    suppressTapUntil = Date.now() + 250;
  }
  mousePan = null;
  setDragging(false);
  springBackToBounds();
}

function handleWheelZoom(e) {
  if (!state || els.fieldModal.classList.contains("hidden")) return;

  // Trackpad pinch on desktop fires wheel events with ctrlKey = true
  if (!e.ctrlKey) return;

  e.preventDefault();
  cancelSpring();

  const rect = els.modalBoardScroll.getBoundingClientRect();
  const anchorX = e.clientX - rect.left;
  const anchorY = e.clientY - rect.top;

  let delta = e.deltaY;
  if (e.deltaMode === 1 /* DOM_DELTA_LINE */) delta *= 16;
  if (e.deltaMode === 2 /* DOM_DELTA_PAGE */) delta *= 100;

  const nextScale = clamp(modalScale * (1 - delta * 0.01), ZOOM_MIN, ZOOM_MAX);
  zoomKeepingViewport(nextScale, { x: anchorX, y: anchorY });
}

function touchesDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getModalMetrics() {
  if (!els.modalStage || !els.modalBoardScroll) {
    return { viewportW: 0, viewportH: 0, contentW: 0, contentH: 0 };
  }

  return {
    viewportW: els.modalBoardScroll.clientWidth,
    viewportH: els.modalBoardScroll.clientHeight,
    contentW: els.modalStage.offsetWidth * modalScale,
    contentH: els.modalStage.offsetHeight * modalScale,
  };
}

function getModalBounds() {
  const { viewportW, viewportH, contentW, contentH } = getModalMetrics();

  const minX = contentW <= viewportW ? (viewportW - contentW) / 2 : viewportW - contentW;
  const maxX = contentW <= viewportW ? (viewportW - contentW) / 2 : 0;

  const minY = contentH <= viewportH ? (viewportH - contentH) / 2 : viewportH - contentH;
  const maxY = contentH <= viewportH ? (viewportH - contentH) / 2 : 0;

  return { minX, maxX, minY, maxY };
}

function applyResistance(value, min, max) {
  if (value < min) return min + (value - min) * SPRING_PULL;
  if (value > max) return max + (value - max) * SPRING_PULL;
  return value;
}

function setOffsetsWithElastic(rawX, rawY) {
  const bounds = getModalBounds();
  modalOffsetX = applyResistance(rawX, bounds.minX, bounds.maxX);
  modalOffsetY = applyResistance(rawY, bounds.minY, bounds.maxY);
  applyModalTransform();
}

function clampToBoundsImmediate() {
  const bounds = getModalBounds();
  modalOffsetX = clamp(modalOffsetX, bounds.minX, bounds.maxX);
  modalOffsetY = clamp(modalOffsetY, bounds.minY, bounds.maxY);
}

function zoomKeepingViewport(nextScale, anchor = null) {
  if (!state) return;

  cancelSpring();

  const rect = els.modalBoardScroll.getBoundingClientRect();
  const anchorX = anchor?.x ?? rect.width / 2;
  const anchorY = anchor?.y ?? rect.height / 2;

  const boardX = (anchorX - modalOffsetX) / modalScale;
  const boardY = (anchorY - modalOffsetY) / modalScale;

  modalScale = nextScale;

  const rawX = anchorX - boardX * modalScale;
  const rawY = anchorY - boardY * modalScale;

  setOffsetsWithElastic(rawX, rawY);
  applyPerformanceMode();
  springBackToBounds();
}

function cancelSpring() {
  if (springFrame) {
    cancelAnimationFrame(springFrame);
    springFrame = 0;
  }
}

function springBackToBounds() {
  cancelSpring();

  const bounds = getModalBounds();
  const targetX = clamp(modalOffsetX, bounds.minX, bounds.maxX);
  const targetY = clamp(modalOffsetY, bounds.minY, bounds.maxY);

  if (Math.abs(targetX - modalOffsetX) < 0.5 && Math.abs(targetY - modalOffsetY) < 0.5) {
    modalOffsetX = targetX;
    modalOffsetY = targetY;
    applyModalTransform();
    return;
  }

  const tick = () => {
    modalOffsetX += (targetX - modalOffsetX) * 0.18;
    modalOffsetY += (targetY - modalOffsetY) * 0.18;

    if (Math.abs(targetX - modalOffsetX) < 0.5 && Math.abs(targetY - modalOffsetY) < 0.5) {
      modalOffsetX = targetX;
      modalOffsetY = targetY;
      applyModalTransform();
      springFrame = 0;
      return;
    }

    applyModalTransform();
    springFrame = requestAnimationFrame(tick);
  };

  springFrame = requestAnimationFrame(tick);
}

function setDragging(active) {
  els.modalBoardScroll?.classList.toggle("dragging", !!active);
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
    els.reviveBtn.classList.add("hidden");
    revivePending = false;
    return;
  }

  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = state.status || "Раунд завершён";
  els.overlayActionBtn.textContent = state.online ? "Рестарт комнаты" : "Сыграть ещё";

  els.modalRestartBtn.classList.remove("hidden");
  els.modalRestartBtn.textContent = state.online ? "Рестарт комнаты" : "Сыграть ещё";

  if (state.canRevive) {
    els.reviveBtn.classList.remove("hidden");
    els.reviveBtn.disabled = revivePending;
  } else {
    els.reviveBtn.classList.add("hidden");
  }
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
  const endSec = (gameState.over && gameState.endedAt)
    ? Number(gameState.endedAt)
    : Math.floor(Date.now() / 1000);
  return Math.max(0, endSec - Number(gameState.startedAt));
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
  applyFullscreenMode();
  requestAnimationFrame(() => {
    if (state) fitZoom();
    applyPerformanceMode();
  });
}

function closeFieldModal() {
  els.fieldModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  setDragging(false);
  cleanFullscreenMode = false;
  applyFullscreenMode();
}

function applyFullscreenMode() {
  const card = document.querySelector(".field-modal-card");
  if (!card) return;

  els.fieldModal.classList.toggle("fullscreen-clean", cleanFullscreenMode);
  card.classList.toggle("fullscreen-clean", cleanFullscreenMode);

  els.closeFieldBtn.textContent = cleanFullscreenMode ? "Вернуться" : "Закрыть";
  els.fullscreenFieldBtn.textContent = cleanFullscreenMode ? "↙" : "⤢";
}


function applyPerformanceMode() {
  const cellsCount = (state?.rows || 0) * (state?.cols || 0);
  const heavy = cellsCount >= 256 || modalScale > 1.35;
  els.modalBoardScroll.classList.toggle("performance-mode", heavy);
}


function fitZoom() {
  if (!state || !els.modalStage) return;

  cancelSpring();

  const viewportW = Math.max(240, els.modalBoardScroll.clientWidth);
  const viewportH = Math.max(240, els.modalBoardScroll.clientHeight);
  const contentW = Math.max(1, els.modalStage.offsetWidth);
  const contentH = Math.max(1, els.modalStage.offsetHeight);

  modalScale = clamp(Math.min(viewportW / contentW, viewportH / contentH), ZOOM_MIN, ZOOM_MAX);
  modalOffsetX = 0;
  modalOffsetY = 0;

  clampToBoundsImmediate();
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
  if (cols >= 40) return w < 420 ? 8 : w < 700 ? 9 : 10;
  if (cols >= 30) return w < 420 ? 9 : w < 700 ? 10 : 11;
  if (cols >= 24) return w < 420 ? 11 : w < 700 ? 12 : 13;
  if (cols >= 16) return w < 420 ? 13 : w < 700 ? 15 : 17;
  if (cols >= 12) return w < 420 ? 16 : w < 700 ? 18 : 22;
  return w < 420 ? 24 : 28;
}

function getModalBaseCellSize(cols) {
  const w = window.innerWidth;
  if (cols >= 40) return w < 420 ? 10 : w < 700 ? 12 : 14;
  if (cols >= 30) return w < 420 ? 12 : w < 700 ? 14 : 16;
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
    if (playerId !== state?.you?.id && Number.isInteger(cell) && cell >= 0) {
      hovered.add(String(cell));
    }
  });

  // Remove decoration only from cells no longer hovered
  prevHoveredIndices.forEach((idx) => {
    if (!hovered.has(idx)) {
      document.querySelectorAll(`.cell[data-index="${idx}"]`).forEach((el) => {
        el.classList.remove("hovered-by-other");
      });
    }
  });

  // Add decoration only to newly hovered cells
  hovered.forEach((idx) => {
    if (!prevHoveredIndices.has(idx)) {
      document.querySelectorAll(`.cell[data-index="${idx}"]`).forEach((el) => {
        el.classList.add("hovered-by-other");
      });
    }
  });

  prevHoveredIndices = hovered;
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

async function copyRoomCode() {
  const code = state?.roomCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    const btn = els.copyCodeBtn;
    const prev = btn.textContent;
    btn.textContent = "✓";
    setTimeout(() => { btn.textContent = prev; }, 1200);
    impact("light");
  } catch (_) {
    toast(state.roomCode);
  }
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

function openAdminModal() {
  els.adminModal.classList.remove("hidden");
  if (!adminStats) loadAdminStats();
  impact("light");
}

function closeAdminModal() {
  els.adminModal.classList.add("hidden");
}

async function loadAdminStats() {
  if (!isAdmin || !tg?.initData) return;

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
    els.adminSummary.innerHTML = `<div class="placeholder">Не удалось загрузить данные</div>`;
  }
}

function renderAdmin() {
  if (!adminStats) return;

  const s = adminStats.summary || {};
  const byMode = adminStats.byMode || {};
  const purchases = adminStats.purchases || {};
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

  const skinNames = { matrix: "Матрица", sunset: "Закат", ocean: "Океан", neon: "Неон", arctic: "Арктика" };
  const skinPurchases = purchases.skins || {};
  const skinCards = Object.entries(skinNames)
    .map(([id, name]) => `<div class="admin-card"><span>${name}</span><strong>${skinPurchases[id] ?? 0}</strong></div>`)
    .join("");
  els.adminPurchases.innerHTML = `
    <div class="admin-card"><span>Возрождений куплено</span><strong>${purchases.revives ?? 0}</strong></div>
    <div class="admin-card"><span>Подписок продано</span><strong>${purchases.subscriptions ?? 0}</strong></div>
    <div class="admin-card"><span>Активных подписок</span><strong>${purchases.activeSubscriptions ?? 0}</strong></div>
    <div class="admin-card"><span>С привилегией</span><strong>${purchases.privilegedUsers ?? 0}</strong></div>
    ${skinCards}
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
          const isAdminUser = item.id === ADMIN_TG_ID;
          const banBtn = isAdminUser ? "" : item.banned
            ? `<button class="ban-btn unban" data-unban-user="${item.id}">Разбанить</button>`
            : `<button class="ban-btn ban" data-ban-user="${item.id}">Забанить</button>`;
          const privBtn = isAdminUser ? "" : item.isPrivileged
            ? `<button class="ban-btn unban" data-revoke-privilege="${item.id}">Убрать безлимит</button>`
            : `<button class="ban-btn" data-grant-privilege="${item.id}">Дать безлимит</button>`;
          const skinBtns = isAdminUser ? "" : `
            <div class="admin-skin-grant">
              <span>Скины выдать:</span>
              <button class="ban-btn" data-grant-skin="${escapeHtml(item.id)}" data-skin-id="matrix">Matrix</button>
              <button class="ban-btn" data-grant-skin="${escapeHtml(item.id)}" data-skin-id="sunset">Закат</button>
              <button class="ban-btn" data-grant-skin="${escapeHtml(item.id)}" data-skin-id="ocean">Океан</button>
              <button class="ban-btn" data-grant-skin="${escapeHtml(item.id)}" data-skin-id="neon">Неон</button>
              <button class="ban-btn" data-grant-skin="${escapeHtml(item.id)}" data-skin-id="arctic">Арктика</button>
              <button class="ban-btn" data-grant-skin="${escapeHtml(item.id)}" data-skin-id="all">Все</button>
            </div>
            <div class="admin-skin-grant">
              <span>Скины забрать:</span>
              <button class="ban-btn ban" data-revoke-skin="${escapeHtml(item.id)}" data-skin-id="matrix">Matrix</button>
              <button class="ban-btn ban" data-revoke-skin="${escapeHtml(item.id)}" data-skin-id="sunset">Закат</button>
              <button class="ban-btn ban" data-revoke-skin="${escapeHtml(item.id)}" data-skin-id="ocean">Океан</button>
              <button class="ban-btn ban" data-revoke-skin="${escapeHtml(item.id)}" data-skin-id="neon">Неон</button>
              <button class="ban-btn ban" data-revoke-skin="${escapeHtml(item.id)}" data-skin-id="arctic">Арктика</button>
            </div>
            <div class="admin-skin-grant">
              <span>Формы выдать:</span>
              <button class="ban-btn" data-grant-shape="${escapeHtml(item.id)}" data-shape-id="circle">Круг</button>
              <button class="ban-btn" data-grant-shape="${escapeHtml(item.id)}" data-shape-id="diamond">Ромб</button>
              <button class="ban-btn" data-grant-shape="${escapeHtml(item.id)}" data-shape-id="cross">Крест</button>
              <button class="ban-btn" data-grant-shape="${escapeHtml(item.id)}" data-shape-id="x_shape">Икс</button>
              <button class="ban-btn" data-grant-shape="${escapeHtml(item.id)}" data-shape-id="frame_x">Рамка</button>
              <button class="ban-btn" data-grant-shape="${escapeHtml(item.id)}" data-shape-id="all">Все</button>
            </div>
            <div class="admin-skin-grant">
              <span>Формы забрать:</span>
              <button class="ban-btn ban" data-revoke-shape="${escapeHtml(item.id)}" data-shape-id="circle">Круг</button>
              <button class="ban-btn ban" data-revoke-shape="${escapeHtml(item.id)}" data-shape-id="diamond">Ромб</button>
              <button class="ban-btn ban" data-revoke-shape="${escapeHtml(item.id)}" data-shape-id="cross">Крест</button>
              <button class="ban-btn ban" data-revoke-shape="${escapeHtml(item.id)}" data-shape-id="x_shape">Икс</button>
              <button class="ban-btn ban" data-revoke-shape="${escapeHtml(item.id)}" data-shape-id="frame_x">Рамка</button>
            </div>
          `;
          return `
            <div class="admin-item">
              <div class="admin-item-top">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${item.banned ? "Забанен" : item.isPrivileged ? "Безлимит" : "Активен"}</span>
              </div>
              <div class="admin-meta">Игры: ${item.games} · Победы: ${item.wins} · Очки: ${item.totalScore}</div>
              <div class="admin-actions">
                ${banBtn}
                ${privBtn}
              </div>
              ${skinBtns}
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
    btn.onclick = async () => { await setBan(btn.dataset.banUser, true); };
  });

  document.querySelectorAll("[data-unban-user]").forEach((btn) => {
    btn.onclick = async () => { await setBan(btn.dataset.unbanUser, false); };
  });

  document.querySelectorAll("[data-grant-privilege]").forEach((btn) => {
    btn.onclick = async () => { await setPrivilege(btn.dataset.grantPrivilege, true); };
  });

  document.querySelectorAll("[data-revoke-privilege]").forEach((btn) => {
    btn.onclick = async () => { await setPrivilege(btn.dataset.revokePrivilege, false); };
  });

  document.querySelectorAll("[data-grant-skin]").forEach((btn) => {
    btn.onclick = async () => { await setGrantSkin(btn.dataset.grantSkin, btn.dataset.skinId, btn); };
  });

  document.querySelectorAll("[data-revoke-skin]").forEach((btn) => {
    btn.onclick = async () => { await setRevokeSkin(btn.dataset.revokeSkin, btn.dataset.skinId, btn); };
  });

  document.querySelectorAll("[data-grant-shape]").forEach((btn) => {
    btn.onclick = async () => { await setGrantShape(btn.dataset.grantShape, btn.dataset.shapeId, btn); };
  });

  document.querySelectorAll("[data-revoke-shape]").forEach((btn) => {
    btn.onclick = async () => { await setRevokeShape(btn.dataset.revokeShape, btn.dataset.shapeId, btn); };
  });
}

async function setPrivilege(userId, grant) {
  if (!userId) return;
  const endpoint = grant ? "/api/admin/grant-privilege" : "/api/admin/revoke-privilege";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData,
      },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");
    toast(grant ? "Безлимит выдан" : "Безлимит отозван");
    await loadAdminStats();
  } catch (e) {
    toast(e.message || "Ошибка");
  }
}

async function setGrantSkin(userId, skinId, btn) {
  if (!userId || !skinId) return;
  const origText = btn?.textContent ?? "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    const res = await fetch("/api/admin/grant-skin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData,
      },
      body: JSON.stringify({ userId, skinId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");
    if (btn) {
      btn.textContent = "✓";
      btn.classList.add("granted");
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = origText;
          btn.classList.remove("granted");
          btn.disabled = false;
        }
      }, 2000);
    }
    toast(skinId === "all" ? "Все скины выданы" : "Скин выдан");
  } catch (e) {
    if (btn) {
      btn.textContent = "✗";
      btn.classList.add("grant-error");
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = origText;
          btn.classList.remove("grant-error");
          btn.disabled = false;
        }
      }, 2000);
    }
    toast(e.message || "Ошибка");
  }
}

async function setRevokeSkin(userId, skinId, btn) {
  if (!userId || !skinId) return;
  const origText = btn?.textContent ?? "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    const res = await fetch("/api/admin/revoke-skin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg.initData,
      },
      body: JSON.stringify({ userId, skinId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");
    if (btn) {
      btn.textContent = "✓";
      btn.classList.add("granted");
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = origText;
          btn.classList.remove("granted");
          btn.disabled = false;
        }
      }, 2000);
    }
    toast("Скин отозван");
  } catch (e) {
    if (btn) {
      btn.textContent = "✗";
      btn.classList.add("grant-error");
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = origText;
          btn.classList.remove("grant-error");
          btn.disabled = false;
        }
      }, 2000);
    }
    toast(e.message || "Ошибка");
  }
}

async function setGrantShape(userId, shapeId, btn) {
  if (!userId || !shapeId) return;
  const origText = btn?.textContent ?? "";
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    const res = await fetch("/api/admin/grant-shape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": tg.initData },
      body: JSON.stringify({ userId, shapeId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");
    if (btn) {
      btn.textContent = "✓";
      btn.classList.add("granted");
      setTimeout(() => {
        if (btn.isConnected) { btn.textContent = origText; btn.classList.remove("granted"); btn.disabled = false; }
      }, 2000);
    }
    toast(shapeId === "all" ? "Все формы выданы" : "Форма выдана");
  } catch (e) {
    if (btn) {
      btn.textContent = "✗";
      btn.classList.add("grant-error");
      setTimeout(() => {
        if (btn.isConnected) { btn.textContent = origText; btn.classList.remove("grant-error"); btn.disabled = false; }
      }, 2000);
    }
    toast(e.message || "Ошибка");
  }
}

async function setRevokeShape(userId, shapeId, btn) {
  if (!userId || !shapeId) return;
  const origText = btn?.textContent ?? "";
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    const res = await fetch("/api/admin/revoke-shape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": tg.initData },
      body: JSON.stringify({ userId, shapeId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");
    if (btn) {
      btn.textContent = "✓";
      btn.classList.add("granted");
      setTimeout(() => {
        if (btn.isConnected) { btn.textContent = origText; btn.classList.remove("granted"); btn.disabled = false; }
      }, 2000);
    }
    toast("Форма отозвана");
  } catch (e) {
    if (btn) {
      btn.textContent = "✗";
      btn.classList.add("grant-error");
      setTimeout(() => {
        if (btn.isConnected) { btn.textContent = origText; btn.classList.remove("grant-error"); btn.disabled = false; }
      }, 2000);
    }
    toast(e.message || "Ошибка");
  }
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

function applySkin(skinId) {
  if (!skinId || skinId === "default") {
    document.documentElement.removeAttribute("data-skin");
  } else {
    document.documentElement.setAttribute("data-skin", skinId);
  }
}

function openSkinsModal() {
  renderSkinsGrid();
  els.skinsModal.classList.remove("hidden");
  impact("light");
}

function closeSkinsModal() {
  els.skinsModal.classList.add("hidden");
}

function renderSkinsGrid() {
  els.skinsGrid.innerHTML = "";
  const isAdmin = user.id === ADMIN_TG_ID;
  SKIN_CATALOG.forEach((skin) => {
    const isOwned = skin.price === 0 || isAdmin || ownedSkins.includes(skin.id);
    const isActive = activeSkinId === skin.id;
    const isPending = skinPurchasePending === skin.id;

    const card = document.createElement("div");
    card.className = "skin-card";
    if (isActive) card.classList.add(skin.activeClass);

    // Mini board preview
    const preview = document.createElement("div");
    preview.className = `skin-preview ${skin.previewClass}`;
    skin.cells.forEach((cls) => {
      const cell = document.createElement("div");
      cell.className = "skin-preview-cell" + (cls ? " " + cls : "");
      preview.appendChild(cell);
    });

    // Badge
    let badgeHtml = "";
    if (isActive) {
      badgeHtml = `<div class="skin-badge skin-badge-owned">Активен</div>`;
    } else if (isOwned) {
      badgeHtml = `<div class="skin-badge skin-badge-owned">Применить</div>`;
    } else if (isPending) {
      badgeHtml = `<div class="skin-badge skin-badge-price">Покупка...</div>`;
    } else {
      badgeHtml = `<div class="skin-badge skin-badge-price">⭐ ${skin.price}</div>`;
    }

    card.innerHTML = `
      <div class="skin-name">${escapeHtml(skin.name)}</div>
      ${badgeHtml}
    `;
    card.insertBefore(preview, card.firstChild);

    if (isActive) {
      const check = document.createElement("div");
      check.className = "skin-active-check";
      check.textContent = "✓";
      card.appendChild(check);
    }

    card.addEventListener("click", () => {
      if (isActive) return;
      if (isOwned) {
        selectSkin(skin.id);
      } else if (!isPending) {
        buySkin(skin.id);
      }
    });

    els.skinsGrid.appendChild(card);
  });
}

function renderShapeSelector() {
  const container = document.getElementById("shapeSelector");
  const hint = document.getElementById("shapePurchaseHint");
  if (!container) return;

  const hasAccess = isAdmin || isPrivileged || hasSubscription || user.id === ADMIN_TG_ID;
  let anyLocked = false;

  container.innerHTML = "";
  SHAPE_CATALOG.forEach((shape) => {
    const isOwned = shape.price === 0 || hasAccess || ownedShapes.includes(shape.id);
    const isSelected = selectedShape === shape.id;
    const isPending = shapePurchasePending === shape.id;

    if (!isOwned) anyLocked = true;

    const btn = document.createElement("button");
    btn.className = "shape-btn" + (isSelected ? " shape-btn-active" : "") + (!isOwned ? " shape-btn-locked" : "");
    btn.title = shape.name + (isOwned ? "" : ` — ⭐ ${shape.price}`);
    btn.innerHTML = `<span class="shape-icon">${shape.icon}</span><span class="shape-name">${escapeHtml(shape.name)}</span>` +
      (!isOwned ? `<span class="shape-lock">${isPending ? "…" : "⭐" + shape.price}</span>` : "");

    btn.addEventListener("click", () => {
      if (isOwned) {
        selectedShape = shape.id;
        renderShapeSelector();
        impact("light");
      } else if (!isPending) {
        shapePurchasePending = shape.id;
        renderShapeSelector();
        send({ type: "shape_purchase_request", shapeId: shape.id });
        impact("medium");
      }
    });

    container.appendChild(btn);
  });

  if (hint) hint.classList.toggle("hidden", !anyLocked || hasAccess);
}

function selectSkin(skinId) {
  activeSkinId = skinId;
  applySkin(skinId);
  send({ type: "select_skin", skinId });
  renderSkinsGrid();
  impact("light");
}

function buySkin(skinId) {
  if (skinPurchasePending) return;
  skinPurchasePending = skinId;
  renderSkinsGrid();
  send({ type: "skin_purchase_request", skinId });
  impact("medium");
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

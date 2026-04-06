const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();
tg?.setHeaderColor?.("#0b1020");
tg?.setBackgroundColor?.("#0b1020");

const ADMIN_TG_ID = "887152362";
const $ = (sel) => document.querySelector(sel);

const els = {
  userChip: $("#userChip"),
  shareBtn: $("#shareBtn"),

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
  copyLinkBtn: $("#copyLinkBtn"),
  leaveRoomBtn: $("#leaveRoomBtn"),
  restartRoomBtn: $("#restartRoomBtn"),

  modeValue: $("#modeValue"),
  sizeValue: $("#sizeValue"),
  minesValue: $("#minesValue"),
  flagsValue: $("#flagsValue"),
  openedValue: $("#openedValue"),

  statusText: $("#statusText"),
  badge: $("#badge"),
  board: $("#board"),
  playersGrid: $("#playersGrid"),
  overlay: $("#overlay"),
  overlayTitle: $("#overlayTitle"),
  overlayActionBtn: $("#overlayActionBtn"),

  refreshLeaderboardBtn: $("#refreshLeaderboardBtn"),
  leaderboardList: $("#leaderboardList"),

  adminSection: $("#adminSection"),
  refreshAdminBtn: $("#refreshAdminBtn"),
  adminSummary: $("#adminSummary"),
  adminTopUsers: $("#adminTopUsers"),
  adminRecentMatches: $("#adminRecentMatches"),

  toast: $("#toast"),
};

let ws = null;
let state = null;
let leaderboard = [];
let adminStats = null;
let selectedMode = "solo";
let inputMode = "open";
let autoJoinDone = false;
let reconnectTimer = null;

const presets = {
  solo: { rows: 9, cols: 9, mines: 10 },
  coop: { rows: 12, cols: 12, mines: 24 },
  versus: { rows: 12, cols: 12, mines: 24 },
};

const user = resolveTelegramUser();
const initialRoomCode = new URLSearchParams(location.search).get("room")?.toUpperCase() || "";

bindUI();
renderBase();
loadLeaderboard();

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
      inputMode = btn.dataset.input;
      renderBase();
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
    send({
      type: "start_solo",
      rows: getRows(),
      cols: getCols(),
      mines: getMines(),
    });
    impact("light");
  });

  els.createRoomBtn.addEventListener("click", () => {
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
    send({ type: "join_room", code });
  });

  els.copyLinkBtn.addEventListener("click", copyInviteLink);
  els.shareBtn.addEventListener("click", shareInviteLink);

  els.leaveRoomBtn.addEventListener("click", () => {
    send({ type: "leave_room" });
  });

  els.restartRoomBtn.addEventListener("click", () => {
    send({ type: "restart_room" });
  });

  els.overlayActionBtn.addEventListener("click", () => {
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
  });

  els.refreshLeaderboardBtn.addEventListener("click", loadLeaderboard);
  els.refreshAdminBtn.addEventListener("click", loadAdminStats);
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
    render();
    return;
  }

  if (msg.type === "state") {
    state = msg.payload;
    selectedMode = state.mode || selectedMode;
    setBadge(state.over ? "DONE" : "ONLINE", state.over ? "warn" : "ok");
    render();
    if (state.over) {
      loadLeaderboard();
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
  }, 2200);
}

function renderBase() {
  renderModeButtons();
  renderRoomControls();
  renderStats();
  renderLeaderboard();
}

function render() {
  renderBase();
  renderStatus();
  renderPlayers();
  renderBoard();
  renderOverlay();
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
  const roomLinkAvailable = !!state?.roomCode;

  els.startSoloBtn.classList.toggle("hidden", !isSoloSelected);
  els.createRoomBtn.classList.toggle("hidden", isSoloSelected || inOnlineState);
  els.joinBox.classList.toggle("hidden", isSoloSelected || inOnlineState);

  els.roomCard.classList.toggle("hidden", !inOnlineState);
  els.shareBtn.classList.toggle("hidden", !roomLinkAvailable);

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
      <div class="player-name">${escapeHtml(player.name)}</div>
      <div class="player-meta">${player.id === state.you?.id ? "Вы" : "Игрок"}</div>
      <div class="player-score">${player.score ?? 0}</div>
    `;
    els.playersGrid.appendChild(div);
  });
}

function renderBoard() {
  if (!state) {
    els.board.innerHTML = `<div class="empty-state">Выбери режим и начни игру</div>`;
    return;
  }

  const cols = state.cols || 9;
  const cellSize = getCellSize(cols);
  els.board.style.setProperty("--cell-size", `${cellSize}px`);
  els.board.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
  els.board.innerHTML = "";

  state.board.forEach((cell) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.dataset.index = cell.i;

    if (cell.o) btn.classList.add("open");
    if (cell.f && !cell.o) btn.classList.add("flagged");
    if (cell.m && (cell.o || state.over)) btn.classList.add("mine");
    if (cell.by && cell.by === state.you.id) btn.classList.add("by-me");
    if (cell.by && cell.by !== state.you.id) btn.classList.add("by-other");
    if (cell.a) btn.dataset.adj = cell.a;

    btn.addEventListener("click", () => {
      if (state.over) return;
      if (inputMode === "flag") {
        send({ type: "toggle_flag", cell: cell.i });
      } else {
        send({ type: "reveal", cell: cell.i });
      }
      impact("light");
    });

    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (state.over) return;
      send({ type: "toggle_flag", cell: cell.i });
    });

    btn.textContent = getCellText(cell);
    els.board.appendChild(btn);
  });
}

function renderOverlay() {
  if (!state?.over) {
    els.overlay.classList.add("hidden");
    return;
  }

  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = state.status || "Раунд завершён";
  els.overlayActionBtn.textContent = state.online ? "Рестарт комнаты" : "Сыграть ещё";
}

function getCellText(cell) {
  if (cell.f && !cell.o) return "🚩";
  if (cell.m && (cell.o || state?.over)) return "💣";
  if (cell.o && cell.a > 0) return String(cell.a);
  return "";
}

function prettyMode(mode) {
  if (mode === "coop") return "Co-op";
  if (mode === "versus") return "Versus";
  return "Solo";
}

function getInviteLink() {
  if (!state?.roomCode) return "";
  if (state.inviteLink?.startsWith("http")) return state.inviteLink;
  return `${location.origin}/?room=${state.roomCode}`;
}

async function copyInviteLink() {
  const link = getInviteLink();
  if (!link) {
    toast("Нет активной комнаты");
    return;
  }
  await navigator.clipboard.writeText(link);
  toast("Invite-link скопирован");
}

async function shareInviteLink() {
  const link = getInviteLink();
  if (!link) {
    toast("Нет активной комнаты");
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: "MineSprint",
        text: "Заходи в комнату",
        url: link,
      });
      return;
    } catch (_) {}
  }

  await navigator.clipboard.writeText(link);
  toast("Ссылка скопирована");
}

async function loadLeaderboard() {
  try {
    const res = await fetch("/api/leaderboard");
    const data = await res.json();
    leaderboard = data.items || [];
    renderLeaderboard();
  } catch (_) {
    els.leaderboardList.innerHTML = `<div class="placeholder">Не удалось загрузить leaderboard</div>`;
  }
}

function renderLeaderboard() {
  if (!leaderboard.length) {
    els.leaderboardList.innerHTML = `<div class="placeholder">Пока нет сыгранных матчей</div>`;
    return;
  }

  els.leaderboardList.innerHTML = leaderboard
    .map((item, index) => {
      return `
        <div class="lb-item">
          <div class="lb-top">
            <span>#${index + 1} ${escapeHtml(item.name)}</span>
            <span>${item.wins} побед</span>
          </div>
          <div class="lb-meta">
            Игры: ${item.games} · Co-op wins: ${item.coopWins} · Versus wins: ${item.versusWins} · Очки: ${item.totalScore}
          </div>
        </div>
      `;
    })
    .join("");
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
    if (!res.ok) {
      throw new Error(data.error || "admin error");
    }
    adminStats = data;
    renderAdmin();
  } catch (e) {
    els.adminSummary.innerHTML = `<div class="placeholder">Не удалось загрузить админку</div>`;
  }
}

function renderAdmin() {
  if (!adminStats) return;

  const s = adminStats.summary || {};
  const byMode = adminStats.byMode || {};

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

  const topUsers = adminStats.topUsers || [];
  els.adminTopUsers.innerHTML = topUsers.length
    ? topUsers
        .map((item) => {
          return `
            <div class="admin-item">
              <div><strong>${escapeHtml(item.name)}</strong></div>
              <div class="admin-meta">Игры: ${item.games} · Победы: ${item.wins} · Очки: ${item.totalScore}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="placeholder">Нет данных</div>`;

  const recent = adminStats.recentMatches || [];
  els.adminRecentMatches.innerHTML = recent.length
    ? recent
        .map((item) => {
          return `
            <div class="admin-item">
              <div><strong>${escapeHtml(prettyMode(item.mode))}</strong> · ${item.rows}×${item.cols} · ${item.mines} мин</div>
              <div class="admin-meta">${escapeHtml(item.players || "")}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="placeholder">Нет данных</div>`;
}

function getCellSize(cols) {
  const w = window.innerWidth;
  if (cols >= 24) return w < 420 ? 14 : w < 560 ? 16 : 18;
  if (cols >= 16) return w < 420 ? 18 : w < 560 ? 20 : 24;
  if (cols >= 12) return w < 420 ? 22 : w < 560 ? 26 : 30;
  return w < 420 ? 30 : 36;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

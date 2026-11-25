const STAGES = ["насіння", "паросток", "росток", "бутон", "квітка"];
const DAYS_UA = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const STORAGE_KEY = "floraflow_state_v1";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Стан застосунку з відновленням із LocalStorage (REQ-UX-06/07)
let state = {
    defaultMin: 25,
    sound: true,
    notifications: false,
    currentStage: 0,       // 0..4 для поточної рослини
    garden: [],            // завершені квітки: { id, date, sessions }
    dailyMinutes: {},      // { "YYYY-MM-DD": number }
    activeSession: null    // { remainingSec, totalMin, isRunning, updatedAt }
};

let timerId = null;
let leftSec = 25 * 60;
let currentRoute = "home";
let previousRoute = "home";

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            state = { ...state, ...parsed };
        }
    } catch (e) {
        console.warn("Не вдалося завантажити стан:", e);
    }
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("Не вдалося зберегти стан:", e);
    }
}

// Генератор SVG рослини (від насіння до тюльпана)
function plantSVG(stage) {
    const G = "#879D92",
        LEAF = "#BACBBF",
        PETAL = "#ECCBB8",
        SOIL = "#C9B8A6";
    let s = `<svg viewBox="0 0 150 190" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
    s += `<path d="M30 160 H120 L112 182 H38 Z" fill="${SOIL}"/><rect x="26" y="154" width="98" height="10" rx="5" fill="#B7A592"/>`;
    if (stage === 0)
        s += `<ellipse cx="75" cy="152" rx="7" ry="5" fill="#8A7A66"/>`;
    if (stage >= 1)
        s += `<path d="M75 154 V${stage === 1 ? 128 : stage === 2 ? 98 : 74}" stroke="${G}" stroke-width="6" stroke-linecap="round"/>`;
    if (stage === 1)
        s += `<path d="M75 130 C60 128 56 116 58 110 C70 110 76 118 75 130Z M75 130 C90 128 94 116 92 110 C80 110 74 118 75 130Z" fill="${LEAF}" stroke="${G}" stroke-width="3"/>`;
    if (stage >= 2)
        s += `<path d="M75 128 C52 128 44 112 48 102 C66 102 76 114 75 128Z M75 118 C98 118 106 102 102 92 C84 92 74 104 75 118Z" fill="${LEAF}" stroke="${G}" stroke-width="3" stroke-linejoin="round"/>`;
    if (stage === 3)
        s += `<path d="M75 76 C62 70 60 52 75 38 C90 52 88 70 75 76Z" fill="${PETAL}" stroke="${G}" stroke-width="4" stroke-linejoin="round"/>`;
    if (stage === 4)
        s += `<path d="M75 76 C58 74 50 60 52 44 C66 46 76 58 75 76Z M75 76 C92 74 100 60 98 44 C84 46 74 58 75 76Z" fill="${PETAL}" stroke="${G}" stroke-width="4" stroke-linejoin="round"/><path d="M75 78 C64 70 62 50 75 34 C88 50 86 70 75 78Z" fill="#F1D6C6" stroke="${G}" stroke-width="4" stroke-linejoin="round"/>`;
    return s + `</svg>`;
}

const fmt = (t) =>
    `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

const todayKey = () => new Date().toISOString().slice(0, 10);

// М'який звук завершення через Web Audio API
function playGentleChime() {
    if (!state.sound) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(528, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
    } catch (e) {
        // Ігноруємо, якщо браузер блокує автозвук
    }
}

function sendSystemNotification(msg) {
    if (!state.notifications || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
        new Notification("FloraFlow – Deep Focus", { body: msg, icon: "icon.png" });
    }
}

let toastTimer = null;
function showToast(text = "Зміни збережено") {
    const toast = document.getElementById("toast");
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}

// Навігація між розділами (Sitemap)
function navigate(route) {
    if (route !== "settings") {
        previousRoute = route;
    }
    currentRoute = route;

    document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
    document.getElementById(`view-${route}`).classList.remove("hidden");

    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === route);
    });
    document.getElementById("nav-settings").classList.toggle("active", route === "settings");

    if (route === "garden") renderGarden();
    if (route === "stats") renderStats();
    if (route === "settings") renderSettings();
}

// Оновлення екрану «Фокус»
function renderFocus() {
    document.getElementById("plant").innerHTML = plantSVG(state.currentStage);
    document.getElementById("time").textContent = fmt(leftSec);

    const status = document.getElementById("status");
    status.textContent = `Етап росту: ${state.currentStage} / 4 · Стадія: ${STAGES[state.currentStage]}`;
    status.classList.toggle("ok", state.currentStage === 4);

    const isRunning = Boolean(timerId);
    document.querySelectorAll("#focus-hub .pill").forEach((pill) => {
        pill.classList.toggle("active", Number(pill.dataset.min) === state.defaultMin);
        pill.disabled = isRunning || Boolean(state.activeSession);
    });
}

function startTimerInterval() {
    const btn = document.getElementById("start");
    btn.textContent = "Пауза";

    timerId = setInterval(() => {
        leftSec -= 1;
        state.activeSession = {
            remainingSec: leftSec,
            totalMin: state.defaultMin,
            isRunning: true,
            updatedAt: Date.now()
        };
        saveState();

        if (leftSec <= 0) {
            finishSession();
        } else {
            renderFocus();
        }
    }, 1000);
    renderFocus();
}

function toggleTimer() {
    const btn = document.getElementById("start");
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
        btn.textContent = "Продовжити";
        if (state.activeSession) {
            state.activeSession.isRunning = false;
            saveState();
        }
        renderFocus();
        return;
    }
    startTimerInterval();
}

function resetTimer() {
    clearInterval(timerId);
    timerId = null;
    state.activeSession = null;
    leftSec = state.defaultMin * 60;
    document.getElementById("start").textContent = "Почати";
    saveState();
    renderFocus();
}

function finishSession() {
    clearInterval(timerId);
    timerId = null;
    const completedMin = state.activeSession ? state.activeSession.totalMin : state.defaultMin;
    state.activeSession = null;

    // Оновлюємо статистику дня
    const key = todayKey();
    state.dailyMinutes[key] = (state.dailyMinutes[key] || 0) + completedMin;

    // Ріст рослини
    state.currentStage += 1;
    let bloomed = false;

    if (state.currentStage >= 4) {
        bloomed = true;
        state.garden.unshift({
            id: Date.now(),
            date: new Date().toLocaleDateString("uk-UA"),
            sessions: 4
        });
    }

    leftSec = state.defaultMin * 60;
    document.getElementById("start").textContent = "Почати";
    saveState();

    playGentleChime();
    const msg = bloomed
        ? "Тюльпан розквітнув і пересаджений у ваш сад!"
        : `Сесію завершено! Рослина досягла стадії «${STAGES[state.currentStage]}».`;
    sendSystemNotification(msg);

    // Показ екрану завершення та росту
    document.getElementById("focus-hub").classList.add("hidden");
    const compCard = document.getElementById("completion-card");
    document.getElementById("completion-plant").innerHTML = plantSVG(state.currentStage);
    document.getElementById("completion-title").textContent = bloomed
        ? "Квітка розквітла!"
        : "Сесію завершено!";
    document.getElementById("completion-desc").textContent = msg;
    compCard.classList.remove("hidden");

    if (bloomed) {
        state.currentStage = 0; // Нова насінина для наступного циклу
        saveState();
    }
    renderFocus();
}

// Перевірка перерваної сесії при старті (Task Flow 1 / Error State)
function checkInterruptedSession() {
    if (state.activeSession && state.activeSession.remainingSec > 0) {
        leftSec = state.activeSession.remainingSec;
        document.getElementById("interrupted-text").textContent =
            `Вкладку закрили, але прогрес збережено: лишилось ${fmt(leftSec)}`;
        document.getElementById("interrupted-state").classList.remove("hidden");
        document.getElementById("focus-hub").classList.add("hidden");
    }
}

// Екран «Сад» (Task Flow / Empty State)
function renderGarden() {
    const emptyEl = document.getElementById("garden-empty");
    const gridEl = document.getElementById("garden-grid");
    const countEl = document.getElementById("garden-count");

    const hasProgress = state.garden.length > 0 || state.currentStage > 0;
    countEl.textContent = `${state.garden.length} ${state.garden.length === 1 ? "квітка" : "квіток"}`;

    if (!hasProgress) {
        emptyEl.classList.remove("hidden");
        gridEl.classList.add("hidden");
        return;
    }

    emptyEl.classList.add("hidden");
    gridEl.classList.remove("hidden");
    gridEl.innerHTML = "";

    // Поточна активна рослина, якщо вже почала рости
    if (state.currentStage > 0) {
        const activeCard = document.createElement("div");
        activeCard.className = "garden-item active-plant";
        activeCard.innerHTML = `
      ${plantSVG(state.currentStage)}
      <div class="garden-item-title">Росте зараз</div>
      <div class="garden-item-sub">Стадія: ${STAGES[state.currentStage]} (${state.currentStage}/4)</div>
    `;
        gridEl.appendChild(activeCard);
    }

    // Вирощені квітки
    state.garden.forEach((item, idx) => {
        const card = document.createElement("div");
        card.className = "garden-item";
        card.innerHTML = `
      ${plantSVG(4)}
      <div class="garden-item-title">Тюльпан #${state.garden.length - idx}</div>
      <div class="garden-item-sub">Вирощено: ${item.date}</div>
    `;
        gridEl.appendChild(card);
    });
}

// Екран «Статистика» (Task Flow 3)
function renderStats() {
    const emptyEl = document.getElementById("stats-empty");
    const chartWrap = document.getElementById("stats-chart-wrap");
    const barsEl = document.getElementById("stats-bars");
    const totalBadge = document.getElementById("stats-total");

    // Останні 7 днів
    const days = [];
    let totalWeek = 0;
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const mins = state.dailyMinutes[key] || 0;
        totalWeek += mins;
        days.push({
            label: DAYS_UA[d.getDay()],
            mins,
            isToday: i === 0
        });
    }

    totalBadge.textContent = `${totalWeek} хв за тиждень`;

    if (totalWeek === 0) {
        emptyEl.classList.remove("hidden");
        chartWrap.classList.add("hidden");
        return;
    }

    emptyEl.classList.add("hidden");
    chartWrap.classList.remove("hidden");
    barsEl.innerHTML = "";

    const maxMins = Math.max(...days.map((d) => d.mins), 25);

    days.forEach((d) => {
        const pct = Math.round((d.mins / maxMins) * 100);
        const col = document.createElement("div");
        col.className = `bar-col ${d.isToday ? "today" : ""}`;
        col.innerHTML = `
      <span class="bar-val">${d.mins > 0 ? d.mins : ""}</span>
      <div class="bar-fill" style="height: ${Math.max(pct, 4)}%"></div>
      <span class="bar-day">${d.label}</span>
    `;
        barsEl.appendChild(col);
    });
}

// Екран «Налаштування» (Task Flow 2 + Error State)
function renderSettings() {
    document.querySelectorAll("#settings-duration .pill").forEach((pill) => {
        pill.classList.toggle("active", Number(pill.dataset.min) === state.defaultMin);
    });
    document.getElementById("toggle-sound").checked = state.sound;
    document.getElementById("toggle-notif").checked = state.notifications;

    const notifError = document.getElementById("notif-error");
    if ("Notification" in window && Notification.permission === "denied") {
        notifError.classList.remove("hidden");
        document.getElementById("toggle-notif").checked = false;
    } else {
        notifError.classList.add("hidden");
    }
}

function setDuration(min) {
    state.defaultMin = min;
    if (!timerId && !state.activeSession) {
        leftSec = min * 60;
    }
    saveState();
    renderFocus();
    renderSettings();
}

function initTheme() {
    const themeBtn = document.getElementById("theme-toggle");
    const htmlEl = document.documentElement;
    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "dark") {
        htmlEl.classList.add("dark");
        themeBtn.textContent = "☀️";
    } else if (savedTheme === "light") {
        htmlEl.classList.add("light");
        themeBtn.textContent = "🌙";
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        themeBtn.textContent = "☀️";
    }

    themeBtn.addEventListener("click", () => {
        if (htmlEl.classList.contains("dark")) {
            htmlEl.classList.remove("dark");
            htmlEl.classList.add("light");
            localStorage.setItem("theme", "light");
            themeBtn.textContent = "🌙";
        } else {
            htmlEl.classList.remove("light");
            htmlEl.classList.add("dark");
            localStorage.setItem("theme", "dark");
            themeBtn.textContent = "☀️";
        }
    });
}

async function init() {
    loadState();
    leftSec = state.defaultMin * 60;
    initTheme();

    // Безпечне ховання відсутніх картинок без inline onerror
    document.querySelectorAll("img").forEach((img) => {
        img.addEventListener("error", () => {
            img.style.display = "none";
        });
    });

    // Навігація Tab Bar
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => navigate(btn.dataset.tab));
    });

    // Кнопка налаштувань у шапці
    document.getElementById("nav-settings").addEventListener("click", () => {
        if (currentRoute === "settings") {
            navigate(previousRoute);
        } else {
            navigate("settings");
        }
    });
    document.getElementById("btn-close-settings").addEventListener("click", () => navigate(previousRoute));

    // Кнопки переходу до фокусу з Empty States
    document.querySelectorAll(".go-focus-btn").forEach((btn) => {
        btn.addEventListener("click", () => navigate("home"));
    });

    // Вибір тривалості на головному екрані
    document.querySelectorAll("#focus-hub .pill").forEach((pill) => {
        pill.addEventListener("click", () => setDuration(Number(pill.dataset.min)));
    });

    // Керування таймером
    document.getElementById("start").addEventListener("click", toggleTimer);
    document.getElementById("reset").addEventListener("click", resetTimer);
    document.getElementById("demo").addEventListener("click", finishSession);

    // Кнопки перерваної сесії (Error State)
    document.getElementById("btn-resume-interrupted").addEventListener("click", () => {
        document.getElementById("interrupted-state").classList.add("hidden");
        document.getElementById("focus-hub").classList.remove("hidden");
        startTimerInterval();
    });

    document.getElementById("btn-discard-interrupted").addEventListener("click", () => {
        document.getElementById("interrupted-state").classList.add("hidden");
        document.getElementById("focus-hub").classList.remove("hidden");
        resetTimer();
    });

    // Кнопки екрану завершення
    document.getElementById("btn-next-session").addEventListener("click", () => {
        document.getElementById("completion-card").classList.add("hidden");
        document.getElementById("focus-hub").classList.remove("hidden");
        renderFocus();
    });

    document.getElementById("btn-go-garden").addEventListener("click", () => {
        document.getElementById("completion-card").classList.add("hidden");
        document.getElementById("focus-hub").classList.remove("hidden");
        navigate("garden");
    });

    // Налаштування (Task Flow 2: автозбереження + тост)
    document.querySelectorAll("#settings-duration .pill").forEach((pill) => {
        pill.addEventListener("click", () => {
            setDuration(Number(pill.dataset.min));
            showToast("Тривалість збережено");
        });
    });

    document.getElementById("toggle-sound").addEventListener("change", (e) => {
        state.sound = e.target.checked;
        saveState();
        if (state.sound) playGentleChime();
        showToast("Налаштування звуку збережено");
    });

    document.getElementById("toggle-notif").addEventListener("change", async (e) => {
        if (!e.target.checked) {
            state.notifications = false;
            saveState();
            showToast("Сповіщення вимкнено");
            return;
        }

        if (!("Notification" in window)) {
            e.target.checked = false;
            showToast("Браузер не підтримує сповіщення");
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            state.notifications = true;
            saveState();
            document.getElementById("notif-error").classList.add("hidden");
            showToast("Сповіщення увімкнено");
        } else {
            state.notifications = false;
            e.target.checked = false;
            saveState();
            document.getElementById("notif-error").classList.remove("hidden");
        }
    });

    document.getElementById("btn-notif-help").addEventListener("click", () => {
        document.getElementById("notif-help-text").classList.toggle("hidden");
    });

    // Початковий рендер та перевірка перерваної сесії
    renderFocus();
    checkInterruptedSession();

    // Автоперехід із заставки (/splash -> /home)
    await wait(1600);
    const splash = document.getElementById("splash");
    splash.classList.add("fade");
    await wait(500);
    splash.classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
}

init();
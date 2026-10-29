const SESSION_MIN = 25;
const STAGES = ["насіння", "паросток", "росток", "бутон", "квітка"];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let left = SESSION_MIN * 60;
let sessions = 0;
let timerId = null;

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

function render() {
   const stage = Math.min(sessions, STAGES.length - 1);
   document.getElementById("plant").innerHTML = plantSVG(stage);
   document.getElementById("time").textContent = fmt(left);
   const status = document.getElementById("status");
   status.textContent = `Сесій завершено: ${sessions} · Стадія: ${STAGES[stage]}`;
   status.classList.toggle("ok", stage === STAGES.length - 1);
}

function finishSession() {
   clearInterval(timerId);
   timerId = null;
   sessions += 1;
   left = SESSION_MIN * 60;
   document.getElementById("start").textContent = "Старт";
   render();
}

function toggleTimer() {
   const btn = document.getElementById("start");
   if (timerId) {
      clearInterval(timerId);
      timerId = null;
      btn.textContent = "Продовжити";
      return;
   }
   btn.textContent = "Пауза";
   timerId = setInterval(() => {
      left -= 1;
      if (left <= 0) {
         finishSession();
      } else {
         render();
      }
   }, 1000);
}

function resetTimer() {
   clearInterval(timerId);
   timerId = null;
   left = SESSION_MIN * 60;
   document.getElementById("start").textContent = "Старт";
   render();
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
   } else {
      if (
         window.matchMedia &&
         window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
         themeBtn.textContent = "☀️";
      } else {
         themeBtn.textContent = "🌙";
      }
   }

   themeBtn.addEventListener("click", () => {
      if (htmlEl.classList.contains("dark")) {
         htmlEl.classList.remove("dark");
         htmlEl.classList.add("light");
         localStorage.setItem("theme", "light");
         themeBtn.textContent = "🌙";
      } else if (htmlEl.classList.contains("light")) {
         htmlEl.classList.remove("light");
         localStorage.setItem("theme", "system");
         themeBtn.textContent = window.matchMedia(
            "(prefers-color-scheme: dark)",
         ).matches
            ? "☀️"
            : "🌙";
      } else {
         htmlEl.classList.add("dark");
         localStorage.setItem("theme", "dark");
         themeBtn.textContent = "☀️";
      }
   });
}

async function start() {
   initTheme();
   document.getElementById("start").addEventListener("click", toggleTimer);
   document.getElementById("reset").addEventListener("click", resetTimer);
   document.getElementById("demo").addEventListener("click", finishSession);
   render();
   await wait(2000);
   const splash = document.getElementById("splash");
   splash.classList.add("fade");
   await wait(500);
   splash.classList.add("hidden");
   document.getElementById("main").classList.remove("hidden");
}

start();

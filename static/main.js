const DEFAULT_DAILY_PLAN = 30;
const DEFAULT_BATCH_SIZE = 30;
const DUE_PROJECTION_DAYS = 120;
const BATCH_SIZE_OPTIONS = [5, 10, 15, 20, 25, 30];

const STORAGE_KEYS = {
  theme: "engram-theme",
  dailyPlan: "engram-daily-plan",
  batchSize: "engram-batch-size",
  session: "engram-current-session"
};

const state = {
  tasks: [],
  index: 0,
  answeredCount: 0,
  voices: [],
  accent: "uk",
  studyActivity: [],
  stats: null,
  dueProjection: [],
  statsCategory: "study",
  chartRangeDays: 7,
  calendarMonthCursor: startOfMonth(new Date()),
  scrollFadeElements: [],
  dailyPlan: DEFAULT_DAILY_PLAN,
  batchSize: DEFAULT_BATCH_SIZE,
  settingsView: "general",
  isFullScreen: false,
  viewMode: "study",
  allowAutoplay: false,
  hasPlayedInitialAutoplay: false,
  autoplayTimer: null,
  lastForegroundAt: 0,
  speechWarmupDone: false,
  speechWarmupPromise: null
};

const fullScreenIcons = {
  enter: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/>
    </svg>
  `,
  exit: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4v4H5M15 4v4h4M5 15h4v5M19 15h-4v5"/>
    </svg>
  `
};

const els = {
  appShell: document.querySelector(".app-shell"),
  wordText: document.getElementById("wordText"),
  wordCard: document.getElementById("wordCard"),
  transitionCard: document.getElementById("transitionCard"),
  taskTypeTag: document.getElementById("taskTypeTag"),
  progressText: document.getElementById("progressText"),
  phoneticUk: document.getElementById("phoneticUk"),
  phoneticUs: document.getElementById("phoneticUs"),
  answerScroll: document.getElementById("answerScroll"),
  answerPlaceholder: document.getElementById("answerPlaceholder"),
  answerContent: document.getElementById("answerContent"),
  revealButton: document.getElementById("revealButton"),
  reviewActions: document.getElementById("reviewActions"),
  speakButton: document.getElementById("speakButton"),
  themeToggle: document.getElementById("themeToggle"),
  statsButton: document.getElementById("statsButton"),
  fullScreenButton: document.getElementById("fullScreenButton"),
  settingsButton: document.getElementById("settingsButton"),
  currentBook: document.getElementById("currentBook"),
  currentBookMeta: document.getElementById("currentBookMeta"),
  learnedWords: document.getElementById("learnedWords"),
  dueWords: document.getElementById("dueWords"),
  dailyPlanRemaining: document.getElementById("dailyPlanRemaining"),
  dailyPlanMeta: document.getElementById("dailyPlanMeta"),
  learnedWordsTotal: document.getElementById("learnedWordsTotal"),
  meaningsList: document.getElementById("meaningsList"),
  reviewStatus: document.getElementById("reviewStatus"),
  prevButton: document.getElementById("prevButton"),
  nextButton: document.getElementById("nextButton"),
  transitionEyebrow: document.getElementById("transitionEyebrow"),
  transitionTitle: document.getElementById("transitionTitle"),
  transitionBody: document.getElementById("transitionBody"),
  transitionPrevButton: document.getElementById("transitionPrevButton"),
  transitionNextButton: document.getElementById("transitionNextButton"),
  statsModal: document.getElementById("statsModal"),
  settingsModal: document.getElementById("settingsModal"),
  calendarGrid: document.getElementById("calendarGrid"),
  calendarLabel: document.getElementById("calendarLabel"),
  calendarPrev: document.getElementById("calendarPrev"),
  calendarNext: document.getElementById("calendarNext"),
  chartBars: document.getElementById("chartBars"),
  chartCaption: document.getElementById("chartCaption"),
  statsCategorySwitch: document.getElementById("statsCategorySwitch"),
  chartRangeSwitch: document.getElementById("chartRangeSwitch"),
  accentSwitch: document.getElementById("accentSwitch"),
  settingsViewSwitch: document.getElementById("settingsViewSwitch"),
  settingsGeneralView: document.getElementById("settingsGeneralView"),
  settingsGuideView: document.getElementById("settingsGuideView"),
  settingsAboutView: document.getElementById("settingsAboutView"),
  aboutContent: document.getElementById("aboutContent"),
  guideContent: document.getElementById("guideContent"),
  dailyPlanInput: document.getElementById("dailyPlanInput"),
  dailyPlanHint: document.getElementById("dailyPlanHint"),
  batchSizeSelect: document.getElementById("batchSizeSelect")
};

const actionText = {
  unknown: "不认识",
  vague: "模糊",
  known: "认识"
};

const taskTypeText = {
  new: "新词",
  review: "复习词"
};

const statsCategoryText = {
  study: "学习单词",
  new: "新学单词",
  review: "复习单词",
  due: "待复习单词"
};

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function formatForecastLabel(dateKey, offset) {
  if (offset === 0) {
    return "明天";
  }
  if (offset === 1) {
    return "后天";
  }

  const [, month, day] = dateKey.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function getTodayKey() {
  return formatDateKey(new Date());
}

function normalizeDailyPlan(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_DAILY_PLAN;
  }
  return Math.min(Math.round(numeric), 500);
}

function normalizeBatchSize(value) {
  const numeric = Number(value);
  return BATCH_SIZE_OPTIONS.includes(numeric) ? numeric : DEFAULT_BATCH_SIZE;
}

function readStoredNumber(key, fallback, normalize) {
  const stored = localStorage.getItem(key);
  if (stored == null) {
    return fallback;
  }
  return normalize(stored);
}

function getCurrentWord() {
  return state.tasks[state.index] ?? null;
}

function isLastTask() {
  return state.index >= state.tasks.length - 1;
}

function allTasksReviewed() {
  return state.tasks.length > 0 && state.tasks.every((item) => item.reviewed);
}

function hydrateTasks(items) {
  return (items || []).map((item) => ({
    ...item,
    revealed: false,
    reviewed: false,
    action: null,
    reviewLogId: null
  }));
}

function hydrateRestoredTasks(items) {
  return (items || []).map((item) => ({
    ...item,
    revealed: Boolean(item.revealed),
    reviewed: Boolean(item.reviewed),
    action: item.action || null,
    reviewLogId: item.reviewLogId || null
  }));
}

function getMaxUnlockedIndex() {
  if (!state.tasks.length) {
    return 0;
  }
  return Math.min(state.answeredCount, state.tasks.length - 1);
}

function canMoveNext() {
  const item = getCurrentWord();
  if (!item) {
    return false;
  }
  if (item.reviewed && isLastTask() && allTasksReviewed()) {
    return true;
  }
  return state.index < getMaxUnlockedIndex();
}

function updateSpeakButton(label) {
  els.speakButton.textContent = label;
}

function requestNative(method, ...args) {
  if (!window.engramAPI || typeof window.engramAPI[method] !== "function") {
    throw new Error("桌面 API 不可用，请使用 Electron 启动应用。");
  }
  return window.engramAPI[method](...args);
}

function clearSavedSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

function clearAutoplayTimer() {
  if (state.autoplayTimer) {
    window.clearTimeout(state.autoplayTimer);
    state.autoplayTimer = null;
  }
}

function markForegroundActive() {
  state.lastForegroundAt = performance.now();
}

function persistSession() {
  if (state.viewMode === "batch-complete" || state.viewMode === "idle-next-batch") {
    const payload = {
      date: getTodayKey(),
      batchSize: state.batchSize,
      mode: "ready-next-batch"
    };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(payload));
    return;
  }

  if (!state.tasks.length || allTasksReviewed()) {
    clearSavedSession();
    return;
  }

  const payload = {
    date: getTodayKey(),
    batchSize: state.batchSize,
    mode: "study",
    index: state.index,
    answeredCount: state.answeredCount,
    tasks: state.tasks
  };

  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(payload));
}

function restoreSavedSession() {
  const raw = localStorage.getItem(STORAGE_KEYS.session);
  if (!raw) {
    return false;
  }

  try {
    const saved = JSON.parse(raw);
    if (
      saved.date !== getTodayKey() ||
      normalizeBatchSize(saved.batchSize) !== state.batchSize ||
      (
        saved.mode !== "ready-next-batch" &&
        (!Array.isArray(saved.tasks) || !saved.tasks.length)
      )
    ) {
      clearSavedSession();
      return false;
    }

    if (saved.mode === "ready-next-batch") {
      state.viewMode = "idle-next-batch";
      state.tasks = [];
      state.index = 0;
      state.answeredCount = 0;
      return true;
    }

    state.viewMode = "study";
    state.tasks = hydrateRestoredTasks(saved.tasks);
    state.index = Math.min(Math.max(Number(saved.index) || 0, 0), state.tasks.length - 1);
    state.answeredCount = Math.min(
      Math.max(Number(saved.answeredCount) || 0, 0),
      state.tasks.length
    );
    return true;
  } catch (error) {
    console.error(error);
    clearSavedSession();
    return false;
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const fragments = [];
  let listBuffer = [];

  const flushList = () => {
    if (!listBuffer.length) {
      return;
    }
    fragments.push(`<ul>${listBuffer.join("")}</ul>`);
    listBuffer = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed.startsWith("- ")) {
      listBuffer.push(`<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`);
      return;
    }

    flushList();

    if (trimmed.startsWith("### ")) {
      fragments.push(`<h4>${renderInlineMarkdown(trimmed.slice(4))}</h4>`);
      return;
    }

    if (trimmed.startsWith("## ")) {
      fragments.push(`<h3>${renderInlineMarkdown(trimmed.slice(3))}</h3>`);
      return;
    }

    fragments.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  });

  flushList();
  return fragments.join("");
}

function updateDailyPlanPresentation() {
  const todayNewWords = state.stats?.today_new_words || 0;

  if (state.dailyPlan > 0) {
    const remaining = Math.max(state.dailyPlan - todayNewWords, 0);
    els.dailyPlanRemaining.textContent = remaining;
    els.dailyPlanMeta.textContent = `已新学 ${todayNewWords} / 计划 ${state.dailyPlan}`;
    els.dailyPlanHint.textContent = `今日已新学 ${todayNewWords} / 计划 ${state.dailyPlan}，仍可继续新学。`;
  } else {
    els.dailyPlanRemaining.textContent = "—";
    els.dailyPlanMeta.textContent = `今日已新学 ${todayNewWords} / 未设置计划`;
    els.dailyPlanHint.textContent = `今日已新学 ${todayNewWords}，当前未设置每日计划，仍可继续新学。`;
  }

  els.dailyPlanInput.value = String(state.dailyPlan);
}

function applyDailyPlan(value) {
  state.dailyPlan = normalizeDailyPlan(value);
  localStorage.setItem(STORAGE_KEYS.dailyPlan, String(state.dailyPlan));
  updateDailyPlanPresentation();
}

async function applyBatchSize(value, { reload = false, resetSession = true } = {}) {
  state.batchSize = normalizeBatchSize(value);
  localStorage.setItem(STORAGE_KEYS.batchSize, String(state.batchSize));
  els.batchSizeSelect.value = String(state.batchSize);
  if (resetSession) {
    clearSavedSession();
  }

  if (reload) {
    await loadTasks({ forceFresh: true });
  }
}

function renderAccentState() {
  state.accent = "uk";
  document.querySelectorAll("[data-accent]").forEach((button) => {
    button.classList.remove("is-active");
    button.classList.add("is-disabled");
    button.disabled = true;
  });
}

function renderFullScreenButton() {
  const isFullScreen = Boolean(state.isFullScreen);
  els.fullScreenButton.innerHTML = isFullScreen ? fullScreenIcons.exit : fullScreenIcons.enter;
  els.fullScreenButton.setAttribute("aria-label", isFullScreen ? "退出全屏" : "进入全屏");
  els.fullScreenButton.title = isFullScreen ? "退出全屏" : "进入全屏";
}

async function syncWindowState() {
  const payload = await requestNative("getWindowState");
  state.isFullScreen = Boolean(payload?.isFullScreen);
  renderFullScreenButton();
}

async function loadStats() {
  const stats = await requestNative("getStats");
  state.stats = stats;
  els.currentBook.textContent = stats.current_book || "CET6";
  els.currentBookMeta.textContent = `剩余 ${stats.new_words} / 总数 ${stats.total_words}`;
  els.learnedWords.textContent = stats.learned_words;
  els.dueWords.textContent = stats.due_words;
  els.learnedWordsTotal.textContent = stats.learned_words_total;
  updateDailyPlanPresentation();
}

async function loadStudyActivity() {
  state.studyActivity = await requestNative("getStudyActivity");
  if (!state.studyActivity.length) {
    state.calendarMonthCursor = startOfMonth(new Date());
  }
}

async function loadDueProjection() {
  state.dueProjection = await requestNative("getDueProjection", DUE_PROJECTION_DAYS);
}

async function loadAboutContent() {
  const markdown = await requestNative("getAboutContent");
  els.aboutContent.innerHTML = markdownToHtml(markdown);
}

async function loadGuideContent() {
  const markdown = await requestNative("getGuideContent");
  els.guideContent.innerHTML = markdownToHtml(markdown);
}

async function loadTasks({ forceFresh = false } = {}) {
  if (!forceFresh && restoreSavedSession()) {
    renderCurrentWord();
    return;
  }

  const payload = await requestNative("getTodayTasks", state.batchSize);
  state.tasks = hydrateTasks(payload.items);
  state.index = 0;
  state.answeredCount = 0;
  state.viewMode = state.tasks.length ? "study" : "day-complete";
  persistSession();
  renderCurrentWord();
}

async function loadNextBatch() {
  clearSavedSession();
  await Promise.all([
    loadStats(),
    loadStudyActivity(),
    loadDueProjection(),
    loadTasks({ forceFresh: true })
  ]);
}

function getAvailableVoices() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  state.voices = voices;
  return voices;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function ensureVoicesLoaded() {
  let voices = getAvailableVoices();
  if (voices.length) {
    return voices;
  }

  for (let index = 0; index < 10; index += 1) {
    await wait(120);
    voices = getAvailableVoices();
    if (voices.length) {
      return voices;
    }
  }

  return voices;
}

async function waitForVisibility() {
  if (document.visibilityState === "visible") {
    return;
  }

  await new Promise((resolve) => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        document.removeEventListener("visibilitychange", onVisible);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
  });
}

async function waitForFocus() {
  if (document.hasFocus()) {
    return;
  }

  await new Promise((resolve) => {
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      resolve();
    };
    window.addEventListener("focus", onFocus, { once: true });
  });
}

async function waitForSpeechReady() {
  await waitForVisibility();
  await waitForFocus();

  const sinceForeground = performance.now() - state.lastForegroundAt;
  if (sinceForeground < 180) {
    await wait(180 - sinceForeground);
  }
}

async function warmupSpeechEngine() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  if (state.speechWarmupDone) {
    return;
  }

  if (state.speechWarmupPromise) {
    await state.speechWarmupPromise;
    return;
  }

  state.speechWarmupPromise = (async () => {
    try {
      await waitForSpeechReady();
      await ensureVoicesLoaded();

      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(".");
      const voice = chooseVoice(state.accent);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-GB";
      }

      utterance.volume = 0;
      utterance.rate = 1;
      utterance.pitch = 1;

      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        if (synth.speaking || synth.pending) {
          synth.cancel();
        }

        synth.speak(utterance);
        window.setTimeout(finish, 800);
      });

      state.speechWarmupDone = true;
    } finally {
      state.speechWarmupPromise = null;
    }
  })();

  await state.speechWarmupPromise;
}

function chooseVoice(preferredAccent) {
  const voices = state.voices.length ? state.voices : getAvailableVoices();
  const accent = preferredAccent === "us" ? "us" : "uk";

  if (accent === "us") {
    return (
      voices.find((voice) => voice.lang.toLowerCase().startsWith("en-us")) ||
      voices.find((voice) => /american|us/i.test(voice.name)) ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
      null
    );
  }

  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en-gb")) ||
    voices.find((voice) => /british|uk/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
    null
  );
}

async function speakCurrentWord() {
  const item = getCurrentWord();
  if (!item || !("speechSynthesis" in window)) {
    return;
  }

  await waitForSpeechReady();
  await ensureVoicesLoaded();

  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(item.word);
  const voice = chooseVoice(state.accent);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-GB";
  }

  utterance.rate = 0.92;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onstart = () => updateSpeakButton("播放中...");
  utterance.onend = () => updateSpeakButton("播放");
  utterance.onerror = () => updateSpeakButton("重试发音");

  if (synth.paused) {
    synth.resume();
  }

  // On some Windows voices, canceling and speaking in the same tick can clip the first phoneme.
  if (synth.speaking || synth.pending) {
    synth.cancel();
    await wait(90);
  }

  synth.speak(utterance);
}

function scheduleAutoplay() {
  clearAutoplayTimer();
  if (!state.allowAutoplay || state.viewMode !== "study" || !getCurrentWord()) {
    return;
  }

  const delay = state.hasPlayedInitialAutoplay ? 80 : 200;
  state.autoplayTimer = window.setTimeout(() => {
    state.autoplayTimer = null;
    if (!state.allowAutoplay || state.viewMode !== "study" || !getCurrentWord()) {
      return;
    }

    const play = async () => {
      if (!state.hasPlayedInitialAutoplay) {
        await warmupSpeechEngine();
        await wait(200);
      }

      state.hasPlayedInitialAutoplay = true;
      await speakCurrentWord();
    };

    play().catch(console.error);
  }, delay);
}

function renderMeanings(meanings) {
  els.meaningsList.innerHTML = "";
  const list = meanings || [];
  if (!list.length) {
    els.meaningsList.innerHTML = '<p class="meaning-empty">释义待补充</p>';
    return;
  }

  list.forEach((entry) => {
    const line = document.createElement("p");
    line.className = "meaning-line";

    const pos = document.createElement("span");
    pos.className = "meaning-pos";
    pos.textContent = entry.pos;

    const definitions = document.createElement("span");
    definitions.className = "meaning-definitions";
    definitions.textContent = (entry.definitions || []).join("；");

    line.appendChild(pos);
    line.appendChild(definitions);
    els.meaningsList.appendChild(line);
  });
}

function setAnswerVisibility(revealed) {
  els.answerContent.classList.toggle("is-hidden", !revealed);
  els.answerPlaceholder.classList.toggle("is-hidden", revealed);
  refreshScrollFades();
}

function updateTaskTypeTag(item) {
  if (!item) {
    els.taskTypeTag.textContent = "完成";
    els.taskTypeTag.dataset.type = "done";
    return;
  }

  const taskType = item.task_type || (item.is_new_word ? "new" : "review");
  els.taskTypeTag.textContent = taskTypeText[taskType] || "学习中";
  els.taskTypeTag.dataset.type = taskType;
}

function updateReviewState(item) {
  if (!item) {
    els.reviewStatus.textContent = "已完成";
    els.reviewStatus.dataset.state = "done";
    return;
  }

  if (!item.reviewed) {
    els.reviewStatus.textContent = item.revealed ? "已显示答案" : "未作答";
    els.reviewStatus.dataset.state = item.revealed ? "revealed" : "idle";
    return;
  }

  els.reviewStatus.textContent = `当前选择：${actionText[item.action] || item.action}`;
  els.reviewStatus.dataset.state = item.action || "done";
}

function setReviewButtonsDisabled(disabled) {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = disabled;
  });
}

function renderActiveView() {
  const showStudy = state.viewMode === "study";
  els.wordCard.classList.toggle("is-hidden", !showStudy);
  els.reviewActions.classList.toggle("is-hidden", !showStudy);
  els.transitionCard.classList.toggle("is-hidden", showStudy);
}

function renderTransitionView() {
  if (state.viewMode === "batch-complete") {
    els.transitionEyebrow.textContent = "本组完成";
    els.transitionTitle.textContent = "本组学习已完成！";
    els.transitionBody.textContent = "可以回看上一词，或者按空格 / 点击按钮进入下一组。";
    els.transitionPrevButton.classList.remove("is-hidden");
    els.transitionPrevButton.disabled = state.tasks.length === 0 || state.index <= 0;
    els.transitionNextButton.textContent = "进入下一组";
    return;
  }

  if (state.viewMode === "idle-next-batch") {
    els.transitionEyebrow.textContent = "继续学习";
    els.transitionTitle.textContent = "点击开始新一组单词学习";
    els.transitionBody.textContent = "你上一次停在批次切换处，现在可以直接开始新一组。";
    els.transitionPrevButton.classList.add("is-hidden");
    els.transitionNextButton.textContent = "开始新一组";
    return;
  }

  els.transitionEyebrow.textContent = "今日完成";
  els.transitionTitle.textContent = "今天这轮已完成";
  els.transitionBody.textContent = "当前没有新的待学或到期复习单词。";
  els.transitionPrevButton.classList.add("is-hidden");
  els.transitionNextButton.textContent = "刷新任务";
}

function updateButtons(item) {
  renderActiveView();

  if (state.viewMode === "batch-complete") {
    renderTransitionView();
    return;
  }

  if (state.viewMode === "idle-next-batch") {
    renderTransitionView();
    return;
  }

  if (state.viewMode === "day-complete") {
    renderTransitionView();
    return;
  }

  els.prevButton.disabled = state.index === 0;
  els.nextButton.textContent = "下一词 →";
  setReviewButtonsDisabled(false);

  if (item.revealed) {
    els.revealButton.textContent = "已显示答案";
    els.revealButton.disabled = true;
  } else {
    els.revealButton.textContent = "显示答案";
    els.revealButton.disabled = false;
  }

  if (item.reviewed && isLastTask() && allTasksReviewed()) {
    els.nextButton.textContent = "下一组 →";
    els.nextButton.disabled = false;
    return;
  }

  els.nextButton.disabled = !canMoveNext();
}

function renderEmpty() {
  renderActiveView();
  if (state.viewMode === "batch-complete") {
    renderTransitionView();
    updateButtons(null);
    return;
  }

  if (state.viewMode === "idle-next-batch" || state.viewMode === "day-complete") {
    renderTransitionView();
    updateButtons(null);
    if (state.viewMode === "day-complete") {
      clearSavedSession();
    }
    return;
  }

  if (state.viewMode === "day-complete") {
    clearSavedSession();
  }
  els.phoneticUk.textContent = "";
  els.phoneticUs.textContent = "";
  renderMeanings([]);
  setAnswerVisibility(false);
  updateTaskTypeTag(null);
  updateReviewState(null);
  updateButtons(null);
}

function revisitPreviousFromTransition() {
  if (state.viewMode !== "batch-complete" || state.tasks.length === 0) {
    return;
  }

  state.viewMode = "study";
  state.index = state.tasks.length - 1;
  renderCurrentWord();
}

function renderCurrentWord() {
  if (state.viewMode !== "study") {
    renderEmpty();
    return;
  }

  const item = getCurrentWord();
  if (!item) {
    renderEmpty();
    return;
  }

  els.wordText.textContent = item.word;
  els.progressText.textContent = `${state.index + 1} / ${state.tasks.length}`;
  els.phoneticUk.textContent = item.phonetic_uk ? `英 /${item.phonetic_uk}/` : "英音待补充";
  els.phoneticUs.textContent = item.phonetic_us ? `美 /${item.phonetic_us}/` : "美音待补充";
  renderMeanings(item.meanings);
  setAnswerVisibility(item.revealed);
  updateTaskTypeTag(item);
  updateReviewState(item);
  updateButtons(item);
  persistSession();
  refreshScrollFades();
  scheduleAutoplay();
}

function revealAnswer() {
  if (state.viewMode === "batch-complete" || state.viewMode === "idle-next-batch" || state.viewMode === "day-complete") {
    loadNextBatch().catch(console.error);
    return;
  }

  const item = getCurrentWord();
  if (!item) {
    loadNextBatch().catch(console.error);
    return;
  }

  if (item.reviewed || item.revealed) {
    return;
  }

  item.revealed = true;
  renderCurrentWord();
}

async function goToNextTaskOrBatch() {
  if (state.viewMode === "batch-complete" || state.viewMode === "idle-next-batch" || state.viewMode === "day-complete") {
    await loadNextBatch();
    return;
  }

  const item = getCurrentWord();
  if (!item) {
    await loadNextBatch();
    return;
  }

  if (item.reviewed && isLastTask() && allTasksReviewed()) {
    state.viewMode = "batch-complete";
    persistSession();
    renderCurrentWord();
    return;
  }

  if (!canMoveNext()) {
    return;
  }

  state.index += 1;
  renderCurrentWord();
}

async function submitReview(action) {
  if (state.viewMode !== "study") {
    return;
  }

  const item = getCurrentWord();
  if (!item) {
    return;
  }

  const shouldMoveAfter = item.reviewed || item.revealed;
  const result = await requestNative("updateStatus", item.id, action, item.reviewLogId || null);

  item.reviewed = true;
  item.revealed = true;
  item.action = action;
  item.reviewLogId = result.review_log_id || item.reviewLogId;
  item.task_type = result.task_type || item.task_type;
  state.answeredCount = Math.max(state.answeredCount, state.index + 1);

  await Promise.all([loadStats(), loadStudyActivity(), loadDueProjection()]);

  if (!els.statsModal.classList.contains("hidden")) {
    renderStats();
  }

  if (shouldMoveAfter) {
    await goToNextTaskOrBatch();
    return;
  }

  renderCurrentWord();
}

function navigatePrev() {
  if (state.viewMode === "batch-complete") {
    revisitPreviousFromTransition();
    return;
  }

  if (state.viewMode !== "study") {
    return;
  }

  if (state.index === 0) {
    return;
  }
  state.index -= 1;
  renderCurrentWord();
}

function navigateNext() {
  goToNextTaskOrBatch().catch(console.error);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  els.themeToggle.textContent = theme === "dark" ? "切到浅色" : "切到深色";
}

function toggleTheme() {
  const current = document.body.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

function isModalOpen() {
  return !els.statsModal.classList.contains("hidden") || !els.settingsModal.classList.contains("hidden");
}

function blurActiveControl() {
  const active = document.activeElement;
  if (
    active instanceof HTMLButtonElement ||
    active instanceof HTMLAnchorElement
  ) {
    active.blur();
  }
}

function getActivityValue(entry, category) {
  if (!entry) {
    return 0;
  }
  if (category === "due") {
    return entry.due_words || 0;
  }
  if (category === "new") {
    return entry.new_words || 0;
  }
  if (category === "review") {
    return entry.review_words || 0;
  }
  return entry.study_words || 0;
}

function getActivityMap() {
  const map = new Map();
  state.studyActivity.forEach((entry) => {
    map.set(entry.date, entry);
  });
  return map;
}

function getDueProjectionMap() {
  const map = new Map();
  state.dueProjection.forEach((entry) => {
    map.set(entry.date, entry.count || 0);
  });
  return map;
}

function renderCalendar() {
  const monthStart = state.calendarMonthCursor;
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const nextMonthStart = new Date(year, month + 1, 1);
  const daysInMonth = Math.round((nextMonthStart - monthStart) / (24 * 60 * 60 * 1000));
  const activityMap = getActivityMap();
  const dueMap = getDueProjectionMap();
  const todayKey = getTodayKey();
  const values = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = formatDateKey(new Date(year, month, day));
    values.push(
      state.statsCategory === "due"
        ? (key < todayKey ? 0 : (dueMap.get(key) || 0))
        : getActivityValue(activityMap.get(key), state.statsCategory)
    );
  }

  const maxValue = Math.max(...values, 0);
  els.calendarLabel.textContent = formatMonthLabel(monthStart);
  els.calendarGrid.innerHTML = "";

  for (let index = 0; index < firstDayOffset; index += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-cell is-blank";
    els.calendarGrid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellDate = new Date(year, month, day);
    const key = formatDateKey(cellDate);
    const count = state.statsCategory === "due"
      ? (key < todayKey ? 0 : (dueMap.get(key) || 0))
      : getActivityValue(activityMap.get(key), state.statsCategory);
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    cell.style.setProperty("--heat", maxValue ? count / maxValue : 0);
    cell.title = `${key} · ${statsCategoryText[state.statsCategory]} ${count} 个`;

    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day";
    dayNumber.textContent = day;

    const dayCount = document.createElement("span");
    dayCount.className = "calendar-count";
    dayCount.textContent = count ? `${count}` : "-";

    cell.appendChild(dayNumber);
    cell.appendChild(dayCount);
    els.calendarGrid.appendChild(cell);
  }
}

function renderChart() {
  const totalDays = state.chartRangeDays;
  const activityMap = getActivityMap();
  const dueMap = getDueProjectionMap();
  const rows = [];

  if (state.statsCategory === "due") {
    const startDate = new Date();
    for (let index = 0; index < totalDays; index += 1) {
      const date = addDays(startDate, index);
      const key = formatDateKey(date);
      rows.push({
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        value: dueMap.get(key) || 0
      });
    }
  } else {
    const today = new Date();
    const startDate = addDays(today, -(totalDays - 1));
    for (let index = 0; index < totalDays; index += 1) {
      const date = addDays(startDate, index);
      const key = formatDateKey(date);
      rows.push({
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        value: getActivityValue(activityMap.get(key), state.statsCategory)
      });
    }
  }

  const maxValue = Math.max(...rows.map((row) => row.value), 0);
  els.chartBars.innerHTML = "";

  if (!rows.some((row) => row.value > 0)) {
    els.chartBars.innerHTML = '<p class="empty-state">还没有可展示的统计数据</p>';
    els.chartCaption.textContent = state.statsCategory === "due"
      ? `${statsCategoryText[state.statsCategory]}未来 ${totalDays} 天暂无记录`
      : `${statsCategoryText[state.statsCategory]}近 ${totalDays} 天暂无记录`;
    return;
  }

  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "chart-bar-item";

    const count = document.createElement("span");
    count.className = "chart-bar-count";
    count.textContent = row.value;

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${maxValue ? Math.max((row.value / maxValue) * 180, row.value > 0 ? 12 : 0) : 0}px`;
    bar.title = `${row.key} · ${statsCategoryText[state.statsCategory]} ${row.value} 个`;

    const label = document.createElement("span");
    label.className = "chart-bar-label";
    const shouldShowLabel = totalDays <= 7 || index === 0 || index === rows.length - 1 || index % 5 === 0;
    label.textContent = shouldShowLabel ? row.label : "";

    item.appendChild(count);
    item.appendChild(bar);
    item.appendChild(label);
    els.chartBars.appendChild(item);
  });

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  els.chartCaption.textContent = state.statsCategory === "due"
    ? `${statsCategoryText[state.statsCategory]}未来 ${totalDays} 天累计 ${total} 个`
    : `${statsCategoryText[state.statsCategory]}近 ${totalDays} 天累计 ${total} 个`;
}

function renderStats() {
  els.statsModal.dataset.category = state.statsCategory;
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle("segment-due", button.dataset.category === "due");
    button.classList.toggle("is-active", button.dataset.category === state.statsCategory);
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.range) === state.chartRangeDays);
  });

  renderCalendar();
  renderChart();
  refreshScrollFades();
}

function renderSettingsView() {
  document.querySelectorAll("[data-settings-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.settingsView === state.settingsView);
  });

  els.settingsGeneralView.classList.toggle("is-hidden", state.settingsView !== "general");
  els.settingsGuideView.classList.toggle("is-hidden", state.settingsView !== "guide");
  els.settingsAboutView.classList.toggle("is-hidden", state.settingsView !== "about");
  refreshScrollFades();
}

function openModal(modal) {
  modal.classList.remove("hidden");
  refreshScrollFades();
}

function closeModal(modal) {
  modal.classList.add("hidden");
}

function openStatsModal() {
  openModal(els.statsModal);
  renderStats();
}

function openSettingsModal() {
  state.settingsView = "general";
  openModal(els.settingsModal);
  renderSettingsView();
}

function updateScrollFade(element) {
  if (!element) {
    return;
  }

  const maxScrollTop = element.scrollHeight - element.clientHeight;
  const hasOverflow = maxScrollTop > 2;
  element.classList.toggle("has-top-shadow", hasOverflow && element.scrollTop > 2);
  element.classList.toggle("has-bottom-shadow", hasOverflow && element.scrollTop < maxScrollTop - 2);
}

function refreshScrollFades() {
  state.scrollFadeElements.forEach((element) => updateScrollFade(element));
}

function registerScrollFades() {
  state.scrollFadeElements = Array.from(document.querySelectorAll("[data-scroll-fade]"));
  state.scrollFadeElements.forEach((element) => {
    element.addEventListener("scroll", () => updateScrollFade(element));
    updateScrollFade(element);
  });
  window.addEventListener("resize", refreshScrollFades);
}

async function handleSpaceKey() {
  blurActiveControl();
  if (state.viewMode === "batch-complete" || state.viewMode === "idle-next-batch" || state.viewMode === "day-complete") {
    await loadNextBatch();
    return;
  }

  const item = getCurrentWord();
  if (!item) {
    await loadNextBatch();
    return;
  }

  if (!item.revealed && !item.reviewed) {
    revealAnswer();
    return;
  }

  await speakCurrentWord();
}

function bindEvents() {
  markForegroundActive();
  window.addEventListener("focus", markForegroundActive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      markForegroundActive();
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) {
      window.setTimeout(() => button.blur(), 0);
    }
  });

  els.themeToggle.addEventListener("click", toggleTheme);
  els.statsButton.addEventListener("click", openStatsModal);
  els.fullScreenButton.addEventListener("click", async () => {
    const payload = await requestNative("toggleFullScreen");
    state.isFullScreen = Boolean(payload?.isFullScreen);
    renderFullScreenButton();
  });
  els.settingsButton.addEventListener("click", openSettingsModal);
  els.revealButton.addEventListener("click", revealAnswer);
  els.speakButton.addEventListener("click", () => {
    speakCurrentWord().catch(console.error);
  });
  els.prevButton.addEventListener("click", navigatePrev);
  els.nextButton.addEventListener("click", navigateNext);
  els.transitionPrevButton.addEventListener("click", revisitPreviousFromTransition);
  els.transitionNextButton.addEventListener("click", navigateNext);
  els.calendarPrev.addEventListener("click", () => {
    state.calendarMonthCursor = new Date(state.calendarMonthCursor.getFullYear(), state.calendarMonthCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  els.calendarNext.addEventListener("click", () => {
    state.calendarMonthCursor = new Date(state.calendarMonthCursor.getFullYear(), state.calendarMonthCursor.getMonth() + 1, 1);
    renderCalendar();
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitReview(button.dataset.action);
    });
  });

  els.statsCategorySwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) {
      return;
    }

    state.statsCategory = button.dataset.category;
    renderStats();
  });

  els.chartRangeSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) {
      return;
    }

    state.chartRangeDays = Number(button.dataset.range) || 7;
    renderStats();
  });

  els.settingsViewSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-view]");
    if (!button) {
      return;
    }

    const nextView = button.dataset.settingsView;
    state.settingsView = nextView === "about" || nextView === "guide" ? nextView : "general";
    renderSettingsView();
  });

  els.dailyPlanInput.addEventListener("change", () => {
    applyDailyPlan(els.dailyPlanInput.value);
  });
  els.dailyPlanInput.addEventListener("blur", () => {
    applyDailyPlan(els.dailyPlanInput.value);
  });

  els.batchSizeSelect.addEventListener("change", async () => {
    await applyBatchSize(els.batchSizeSelect.value, { reload: true });
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.close;
      if (target === "stats") {
        closeModal(els.statsModal);
      } else if (target === "settings") {
        closeModal(els.settingsModal);
      }
    });
  });

  document.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      closeModal(els.statsModal);
      closeModal(els.settingsModal);
      return;
    }

    if (isModalOpen()) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      await handleSpaceKey();
      return;
    }

    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      blurActiveControl();
      await speakCurrentWord();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      blurActiveControl();
      navigatePrev();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      blurActiveControl();
      navigateNext();
      return;
    }

    if (event.key === "1") {
      blurActiveControl();
      await submitReview("unknown");
    } else if (event.key === "2") {
      blurActiveControl();
      await submitReview("vague");
    } else if (event.key === "3") {
      blurActiveControl();
      await submitReview("known");
    }
  });

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      getAvailableVoices();
    };
  }

  if (window.engramAPI?.onWindowStateChange) {
    window.engramAPI.onWindowStateChange((payload) => {
      state.isFullScreen = Boolean(payload?.isFullScreen);
      renderFullScreenButton();
    });
  }

  window.addEventListener("beforeunload", persistSession);
}

async function init() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || "dark";

  state.dailyPlan = readStoredNumber(STORAGE_KEYS.dailyPlan, DEFAULT_DAILY_PLAN, normalizeDailyPlan);
  state.batchSize = readStoredNumber(STORAGE_KEYS.batchSize, DEFAULT_BATCH_SIZE, normalizeBatchSize);

  applyTheme(savedTheme === "light" ? "light" : "dark");
  applyDailyPlan(state.dailyPlan);
  await applyBatchSize(state.batchSize, { resetSession: false });
  renderAccentState();
  renderFullScreenButton();
  getAvailableVoices();
  bindEvents();
  registerScrollFades();

  try {
    await Promise.all([
      syncWindowState(),
      loadAboutContent(),
      loadGuideContent(),
      loadStats(),
      loadStudyActivity(),
      loadDueProjection(),
      loadTasks()
    ]);
    await requestNative("showWindow");
    state.allowAutoplay = true;
    if (state.viewMode === "study") {
      scheduleAutoplay();
    }
    renderSettingsView();
    refreshScrollFades();
  } catch (error) {
    console.error(error);
    try {
      await requestNative("showWindow");
    } catch (showError) {
      console.error(showError);
    }
    els.wordText.textContent = "加载失败";
    els.progressText.textContent = "-";
    els.answerPlaceholder.textContent = String(error.message || error);
    els.answerContent.classList.add("is-hidden");
    els.answerPlaceholder.classList.remove("is-hidden");
    els.revealButton.disabled = true;
  }
}

init();

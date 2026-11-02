import { MINUTE, clamp, formatRemaining, msUntilClockTime } from './time.js';
import { Countdown } from './countdown.js';

/* ---------- Configuration ---------- */

const APP_NAME = 'Timebox';
const STORAGE_PREFIX = 'timebox.'; // keep in sync with the theme bootstrap in index.html
const THEMES = ['light', 'dark', 'sage'];
const PRESET_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const DEFAULTS = { minutes: 30, thresholdMinutes: 5 };

const TICK_MS = 250;
const CONTROLS_IDLE_MS = 2500;
const NOTE_VISIBLE_MS = 1200;
const COPY_FEEDBACK_MS = 1500;
const RESUME_MAX_AGE_MS = 60 * MINUTE;

const SCALE = { min: 0.3, max: 1.5, factor: 1.1, initial: 1 };
const OFFSET = { min: -40, max: 40, step: 1, initial: 0 }; // % of screen height, negative = up
const PINCH_SENSITIVITY = 200;

// Approximate width of one clock glyph in em; used to fit the clock to the screen width.
const GLYPH_WIDTH_EM = 0.62;
const CLOCK_FIT_VW = 92;
const CLOCK_MAX_VW = 98;
const CLOCK_MAX_VH = 52;

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
};

/* ---------- Storage (fails silently in private mode / blocked storage) ---------- */

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* unavailable */ }
  },
  remove(key) {
    try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* unavailable */ }
  },
};

/* ---------- DOM ---------- */

const $ = (selector) => document.querySelector(selector);
const body = document.body;

const el = {
  setup: $('#setup'),
  form: $('#setup-form'),
  titleInput: $('#title-input'),
  durationInput: $('#duration-input'),
  untilInput: $('#until-input'),
  thresholdInput: $('#threshold-input'),
  presets: $('#presets'),
  themeChoices: document.querySelectorAll('[data-theme-choice]'),
  copyLink: $('#copy-link'),

  timer: $('#timer'),
  face: $('#face'),
  title: $('#timer-title'),
  clock: $('#clock'),
  status: $('#status'),
  progress: $('#progress-fill'),
  note: $('#note'),
  pauseButton: $('[data-action="toggle-pause"]'),
  layoutButton: $('[data-action="toggle-layout"]'),
};

const state = {
  countdown: /** @type {Countdown | null} */ (null),
  scale: SCALE.initial,
  offset: OFFSET.initial,
  lastRenderKey: '',
  tickId: 0,
  idleId: 0,
  noteId: 0,
  wakeLock: /** @type {WakeLockSentinel | null} */ (null),
};

/* ---------- Theme ---------- */

function applyTheme(theme) {
  const valid = THEMES.includes(theme) ? theme : THEMES[0];
  document.documentElement.dataset.theme = valid;
  storage.set('theme', valid);
  el.themeChoices.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === valid));
  });
}

function cycleTheme() {
  const index = THEMES.indexOf(document.documentElement.dataset.theme);
  applyTheme(THEMES[(index + 1) % THEMES.length]);
}

function initialTheme() {
  return storage.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/* ---------- Size & position ---------- */

function setScale(value, { announce = true } = {}) {
  state.scale = clamp(Math.round(value * 100) / 100, SCALE.min, SCALE.max);
  el.timer.style.setProperty('--scale', state.scale);
  storage.set('scale', state.scale);
  if (state.countdown) render();
  if (announce) showNote(`Size ${Math.round(state.scale * 100)}%`);
}

const grow = () => setScale(state.scale * SCALE.factor);
const shrink = () => setScale(state.scale / SCALE.factor);
const resetScale = () => setScale(SCALE.initial);

function setOffset(value, { announce = true } = {}) {
  state.offset = clamp(Math.round(value), OFFSET.min, OFFSET.max);
  el.face.style.setProperty('--offset', state.offset);
  storage.set('offset', state.offset);
  if (announce) showNote(describeOffset(state.offset));
}

function describeOffset(offset) {
  if (offset === 0) return 'Centered';
  return `Position: ${offset < 0 ? 'up' : 'down'} ${Math.abs(offset)}`;
}

const moveUp = () => setOffset(state.offset - OFFSET.step);
const moveDown = () => setOffset(state.offset + OFFSET.step);

function resetLayout() {
  setOffset(OFFSET.initial, { announce: false });
  setScale(SCALE.initial, { announce: false });
  showNote('Reset');
}

const isLayoutMode = () => body.classList.contains('layout-mode');

function setLayoutMode(on) {
  body.classList.toggle('layout-mode', on);
  el.layoutButton.setAttribute('aria-pressed', String(on));
}

const openLayout = () => setLayoutMode(true);
const toggleLayout = () => setLayoutMode(!isLayoutMode());

function closeLayout() {
  setLayoutMode(false);
  showControls();
}

/* ---------- Setup form ---------- */

const presetLabel = (minutes) => (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`);

function renderPresets() {
  const buttons = PRESET_MINUTES.map((minutes) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.minutes = String(minutes);
    button.textContent = presetLabel(minutes);
    return button;
  });
  el.presets.replaceChildren(...buttons);
}

/** URL parameters (?m=90&s=10&t=Workshop) take precedence over the last used settings. */
function prefillForm() {
  const params = new URLSearchParams(location.search);
  const prefs = storage.get('prefs') ?? {};
  el.durationInput.value = params.get('m') ?? prefs.minutes ?? DEFAULTS.minutes;
  el.thresholdInput.value = params.get('s') ?? prefs.thresholdMinutes ?? DEFAULTS.thresholdMinutes;
  el.titleInput.value = params.get('t') ?? prefs.title ?? '';
}

function readSettings() {
  const until = el.untilInput.value;
  const durationMs = until ? msUntilClockTime(until) : parseFloat(el.durationInput.value) * MINUTE;
  const thresholdMinutes = Math.max(0, parseFloat(el.thresholdInput.value) || 0);
  return {
    title: el.titleInput.value.trim(),
    durationMs: Math.round(durationMs),
    thresholdMs: thresholdMinutes * MINUTE,
  };
}

function savePrefs() {
  const previous = storage.get('prefs') ?? {};
  storage.set('prefs', {
    // An "until" time is one-off; keep the last real duration instead.
    minutes: el.untilInput.value ? previous.minutes : el.durationInput.value,
    thresholdMinutes: el.thresholdInput.value,
    title: el.titleInput.value.trim(),
  });
}

function handleSubmit(event) {
  event.preventDefault();
  const settings = readSettings();
  if (!(settings.durationMs > 0)) {
    el.durationInput.focus();
    return;
  }
  savePrefs();
  startCountdown(Countdown.start(settings));
}

function handlePresetClick(event) {
  const preset = event.target.closest('[data-minutes]');
  if (!preset) return;
  el.durationInput.value = preset.dataset.minutes;
  el.untilInput.value = '';
}

function shareUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('m', el.durationInput.value);
  url.searchParams.set('s', el.thresholdInput.value);
  const title = el.titleInput.value.trim();
  if (title) url.searchParams.set('t', title);
  return url.href;
}

async function copyShareLink() {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    el.copyLink.textContent = 'Copied!';
    setTimeout(() => { el.copyLink.textContent = 'Copy link'; }, COPY_FEEDBACK_MS);
  } catch {
    prompt('Copy this link:', url);
  }
}

/* ---------- Countdown lifecycle ---------- */

const saveCountdown = () => storage.set('session', state.countdown);

function startCountdown(countdown) {
  state.countdown = countdown;
  state.lastRenderKey = '';
  saveCountdown();

  el.title.textContent = countdown.title;
  el.title.hidden = !countdown.title;
  el.setup.hidden = true;
  el.timer.hidden = false;

  render();
  clearInterval(state.tickId);
  state.tickId = setInterval(render, TICK_MS);
  requestWakeLock();
  showControls();
}

function stopCountdown() {
  if (!state.countdown.isDone() && !confirm('Stop and reset the timer?')) return;

  clearInterval(state.tickId);
  state.countdown = null;
  storage.remove('session');
  releaseWakeLock();

  setLayoutMode(false);
  hideControls();
  body.classList.remove('paused');
  delete body.dataset.phase;
  document.title = APP_NAME;

  el.timer.hidden = true;
  el.setup.hidden = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function togglePause() {
  state.countdown.togglePause();
  saveCountdown();
  render();
}

/** Buffer time: keyboard-only (B / Shift+B), so the audience never sees a button for it. */
function addBuffer(minutes) {
  state.countdown.addTime(minutes * MINUTE);
  saveCountdown();
  render();
  showNote(minutes > 0 ? `+${minutes} min` : `−${-minutes} min`);
}

function resumeSavedCountdown() {
  const saved = Countdown.fromJSON(storage.get('session'));
  if (saved && !saved.isStale(RESUME_MAX_AGE_MS)) startCountdown(saved);
  else storage.remove('session');
}

/* ---------- Rendering ---------- */

function clockFontSize(text, scale) {
  const glyphs = text.replace(/\s/g, '').length * GLYPH_WIDTH_EM;
  const width = ((CLOCK_FIT_VW / glyphs) * scale).toFixed(1);
  const height = (CLOCK_MAX_VH * scale).toFixed(1);
  const maxWidth = (CLOCK_MAX_VW / glyphs).toFixed(1);
  return `min(${width}vw, ${height}vh, ${maxWidth}vw)`;
}

function statusText(phase, paused, endTimestamp) {
  if (phase === 'done') return 'Time’s up';
  if (paused) return 'Paused';
  const endTime = new Date(endTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Ends at ${endTime}`;
}

function render() {
  const { countdown, scale } = state;
  const now = Date.now();
  const remainingMs = countdown.remainingMs(now);

  // The progress bar moves every tick; everything else only when the visible text changes.
  el.progress.style.transform = `scaleX(${countdown.progress(now)})`;

  const display = formatRemaining(remainingMs, countdown);
  const status = statusText(display.phase, countdown.paused, now + remainingMs);
  const renderKey = [display.html, status, countdown.paused, scale].join('|');
  if (renderKey === state.lastRenderKey) return;
  state.lastRenderKey = renderKey;

  body.dataset.phase = display.phase;
  body.classList.toggle('paused', countdown.paused && display.phase !== 'done');
  el.clock.style.setProperty('--size', clockFontSize(display.text, scale));
  el.clock.innerHTML = display.html; // built only from numbers in formatRemaining
  el.status.textContent = status;
  el.pauseButton.innerHTML = countdown.paused ? ICONS.play : ICONS.pause;

  const label = display.phase === 'done' ? 'Time’s up' : display.text;
  document.title = countdown.title ? `${label} · ${countdown.title}` : label;
}

/** Small, short-lived confirmation in the corner, easy to miss for the audience. */
function showNote(text) {
  el.note.textContent = text;
  el.note.classList.add('visible');
  clearTimeout(state.noteId);
  state.noteId = setTimeout(() => el.note.classList.remove('visible'), NOTE_VISIBLE_MS);
}

function showControls() {
  body.classList.add('controls-visible');
  clearTimeout(state.idleId);
  state.idleId = setTimeout(hideControls, CONTROLS_IDLE_MS);
}

function hideControls() {
  clearTimeout(state.idleId);
  body.classList.remove('controls-visible');
}

/* ---------- Browser features ---------- */

function toggleFullscreen() {
  const request = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen?.();
  request?.catch(() => {});
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch {
    // Not allowed (e.g. battery saver); the timer still works.
  }
}

function releaseWakeLock() {
  state.wakeLock?.release();
  state.wakeLock = null;
}

/* ---------- Input ---------- */

const BUTTON_ACTIONS = {
  'toggle-layout': toggleLayout,
  'toggle-pause': togglePause,
  'cycle-theme': cycleTheme,
  'toggle-fullscreen': toggleFullscreen,
  stop: stopCountdown,
  'move-up': moveUp,
  'move-down': moveDown,
  shrink,
  grow,
  'reset-layout': resetLayout,
  'close-layout': closeLayout,
};

// Cmd/Ctrl + / − / 0 resize the timer instead of zooming the page.
const ZOOM_KEYS = { '=': grow, '+': grow, '-': shrink, _: shrink, 0: resetScale };

// Layout mode: arrows move, +/− resize.
const LAYOUT_KEYS = {
  arrowup: moveUp,
  arrowdown: moveDown,
  '+': grow,
  '=': grow,
  '-': shrink,
  0: resetLayout,
  l: closeLayout,
  enter: closeLayout,
  escape: closeLayout,
};

// Time only changes via B / Shift+B, so stray arrow or +/− presses can't alter it.
const TIMER_KEYS = {
  ' ': togglePause,
  p: togglePause,
  b: () => addBuffer(1),
  l: openLayout,
  f: toggleFullscreen,
  t: cycleTheme,
  r: stopCountdown,
};

const SHIFT_KEYS = {
  arrowup: moveUp,
  arrowdown: moveDown,
  b: () => addBuffer(-1),
};

function keyAction(event) {
  const key = event.key.toLowerCase();
  if (event.metaKey || event.ctrlKey) return event.altKey ? undefined : ZOOM_KEYS[key];
  if (event.altKey) return undefined;
  if (event.shiftKey && SHIFT_KEYS[key]) return SHIFT_KEYS[key];
  if (isLayoutMode() && LAYOUT_KEYS[key]) return LAYOUT_KEYS[key];
  return TIMER_KEYS[key];
}

function handleKeydown(event) {
  if (!state.countdown) return; // setup screen: leave browser shortcuts alone
  const action = keyAction(event);
  if (!action) return;
  event.preventDefault();
  action();
}

/** Trackpad pinch (reported as Ctrl + wheel) resizes the timer too. */
function handleWheel(event) {
  if (!state.countdown || !event.ctrlKey) return;
  event.preventDefault();
  setScale(state.scale * Math.exp(-event.deltaY / PINCH_SENSITIVITY));
}

function bindEvents() {
  el.form.addEventListener('submit', handleSubmit);
  el.presets.addEventListener('click', handlePresetClick);
  el.durationInput.addEventListener('input', () => { el.untilInput.value = ''; });
  el.copyLink.addEventListener('click', copyShareLink);
  el.themeChoices.forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  });

  el.timer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) BUTTON_ACTIONS[button.dataset.action]?.();
  });

  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('wheel', handleWheel, { passive: false });
  for (const type of ['mousemove', 'touchstart']) {
    document.addEventListener(type, () => { if (state.countdown) showControls(); }, { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (state.countdown && document.visibilityState === 'visible') requestWakeLock();
  });
}

/* ---------- Start ---------- */

function init() {
  applyTheme(initialTheme());
  renderPresets();
  prefillForm();
  bindEvents();
  setScale(Number(storage.get('scale')) || SCALE.initial, { announce: false });
  setOffset(Number(storage.get('offset')) || OFFSET.initial, { announce: false });
  resumeSavedCountdown();
}

init();

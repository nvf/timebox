import {
  MINUTE, clamp, formatDuration, formatOvertime, formatRemaining, msUntilClockTime, parseDuration,
} from './time.js';
import { Countdown } from './countdown.js';

/* ---------- Configuration ---------- */

const APP_NAME = 'Timebox';
const STORAGE_PREFIX = 'timebox.'; // keep in sync with the theme bootstrap in index.html
const THEMES = ['light', 'dark', 'sage'];
const PRESET_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const DEFAULTS = { minutes: 30, thresholdMinutes: 5, overtime: false };

const TICK_MS = 250;
const CONTROLS_IDLE_MS = 2500;
const NOTE_VISIBLE_MS = 1200;
const RESUME_NOTE_MS = 4000;
const COPY_FEEDBACK_MS = 1500;
const RESUME_MAX_AGE_MS = 60 * MINUTE;
const STOP_CONFIRM_MS = 3000;
const LONG_PRESS_MS = 600;
const LONG_PRESS_SLOP_PX = 10;
const LENGTH_HINT_REFRESH_MS = 15 * 1000;
const SUSPICIOUS_LENGTH_MS = 12 * 60 * MINUTE; // longer usually means a mistyped "until" time

const SCALE = { min: 0.3, max: 1.5, factor: 1.1, initial: 1 };
const OFFSET = { min: -40, max: 40, step: 2, initial: 0 }; // % of screen height, negative = up
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
  lengthHint: $('#length-hint'),
  thresholdInput: $('#threshold-input'),
  overtimeInput: $('#overtime-input'),
  presets: $('#presets'),
  themeChoices: document.querySelectorAll('[data-theme-choice]'),
  copyLink: $('#copy-link'),

  timer: $('#timer'),
  face: $('#face'),
  title: $('#timer-title'),
  clock: $('#clock'),
  status: $('#status'),
  ends: $('#ends'),
  progress: $('#progress-fill'),
  note: $('#note'),
  help: $('#help'),
  pauseButton: $('[data-action="toggle-pause"]'),
  layoutButton: $('[data-action="toggle-layout"]'),
  overtimeButton: $('[data-action="toggle-overtime"]'),
};

const state = {
  countdown: /** @type {Countdown | null} */ (null),
  scale: SCALE.initial,
  offset: OFFSET.initial,
  lastRenderKey: '',
  tickId: 0,
  idleId: 0,
  noteId: 0,
  stopArmedUntil: 0,
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

/* ---------- Shortcut cheat sheet ---------- */

const isHelpOpen = () => !el.help.hidden;
const closeHelp = () => { el.help.hidden = true; };
const toggleHelp = () => { el.help.hidden = !el.help.hidden; };

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
  el.overtimeInput.checked = params.has('o') ? params.get('o') === '1' : (prefs.overtime ?? DEFAULTS.overtime);
  const until = params.get('u');
  if (until && /^\d{1,2}:\d{2}$/.test(until)) el.untilInput.value = until.padStart(5, '0');
}

function readSettings() {
  const until = el.untilInput.value;
  const durationMs = until ? msUntilClockTime(until) : parseDuration(el.durationInput.value);
  const thresholdMinutes = Math.max(0, parseFloat(el.thresholdInput.value) || 0);
  return {
    title: el.titleInput.value.trim(),
    durationMs: Math.round(durationMs),
    thresholdMs: thresholdMinutes * MINUTE,
    overtime: el.overtimeInput.checked,
  };
}

function savePrefs() {
  const previous = storage.get('prefs') ?? {};
  storage.set('prefs', {
    // An "until" time is one-off; keep the last real duration instead.
    minutes: el.untilInput.value ? previous.minutes : el.durationInput.value,
    thresholdMinutes: el.thresholdInput.value,
    overtime: el.overtimeInput.checked,
    title: el.titleInput.value.trim(),
  });
}

function handleSubmit(event) {
  event.preventDefault();
  const settings = readSettings();
  if (!(settings.durationMs > 0)) {
    updateLengthHint();
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
  updateLengthHint();
}

/** Double-clicking a preset starts right away. */
function handlePresetDoubleClick(event) {
  if (!event.target.closest('[data-minutes]')) return;
  handlePresetClick(event);
  el.form.requestSubmit();
}

const formatClockTime = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Shows what the form will start ("1 h 25 min · ends 11:30"), so typos are caught before starting. */
function updateLengthHint() {
  const { durationMs } = readSettings();
  const hint = el.lengthHint;
  if (!(durationMs > 0)) {
    hint.textContent = 'Type minutes (90), h:mm (1:30), or e.g. 1h 30m.';
    hint.classList.add('hint--warn');
    return;
  }
  const length = formatDuration(durationMs);
  const end = formatClockTime(Date.now() + durationMs);
  const suspicious = durationMs > SUSPICIOUS_LENGTH_MS;
  hint.textContent = suspicious ? `Check the time: ${end} is tomorrow (${length})` : `${length} · ends ${end}`;
  hint.classList.toggle('hint--warn', suspicious);
}

function shareUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (el.untilInput.value) url.searchParams.set('u', el.untilInput.value);
  else url.searchParams.set('m', el.durationInput.value.trim());
  url.searchParams.set('s', el.thresholdInput.value);
  if (el.overtimeInput.checked) url.searchParams.set('o', '1');
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

/** Stopping a running timer takes two presses, so a stray key can't end it (and no dialog appears on the projector). */
function requestStop() {
  if (state.countdown.isDone() || Date.now() < state.stopArmedUntil) {
    stopCountdown();
    return;
  }
  state.stopArmedUntil = Date.now() + STOP_CONFIRM_MS;
  showNote('Press R (or ✕) again to stop', STOP_CONFIRM_MS);
}

function stopCountdown() {
  state.stopArmedUntil = 0;
  clearInterval(state.tickId);
  state.countdown = null;
  storage.remove('session');
  releaseWakeLock();

  setLayoutMode(false);
  closeHelp();
  hideControls();
  body.classList.remove('paused', 'overtime');
  delete body.dataset.phase;
  document.title = APP_NAME;

  el.timer.hidden = true;
  el.setup.hidden = false;
  updateLengthHint();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function togglePause() {
  state.countdown.togglePause();
  saveCountdown();
  render();
}

/** Overtime can be switched on before starting or while running (e.g. when a talk runs long). */
function toggleOvertime() {
  state.countdown.overtime = !state.countdown.overtime;
  saveCountdown();
  render();
  showNote(state.countdown.overtime ? 'Overtime on' : 'Overtime off');
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
  if (!saved || saved.isStale(RESUME_MAX_AGE_MS)) {
    storage.remove('session');
    return;
  }
  startCountdown(saved);
  // Browsers only allow fullscreen after a user gesture, so it can't be restored automatically.
  if (!document.fullscreenElement) showNote('Press F for fullscreen', RESUME_NOTE_MS);
}

/* ---------- Rendering ---------- */

function clockFontSize(text, scale) {
  const glyphs = text.replace(/\s/g, '').length * GLYPH_WIDTH_EM;
  const width = ((CLOCK_FIT_VW / glyphs) * scale).toFixed(1);
  const height = (CLOCK_MAX_VH * scale).toFixed(1);
  const maxWidth = (CLOCK_MAX_VW / glyphs).toFixed(1);
  return `min(${width}vw, ${height}vh, ${maxWidth}vw)`;
}

/** Shown under the clock: only states the audience must notice. */
function statusText(phase, paused) {
  if (phase === 'done') return 'Time’s up';
  if (paused) return 'Paused';
  return '';
}

/** Shown small at the bottom of the screen while running. */
function endsText(phase, paused, endTimestamp) {
  if (phase === 'done' || paused) return '';
  return `Ends at ${formatClockTime(endTimestamp)}`;
}

function render() {
  const { countdown, scale } = state;
  const now = Date.now();
  const remainingMs = countdown.remainingMs(now);

  // The progress bar moves every tick; everything else only when the visible text changes.
  el.progress.style.transform = `scaleX(${countdown.progress(now)})`;

  const display = formatRemaining(remainingMs, countdown);
  if (display.phase === 'done' && countdown.overtime) {
    // Keep counting past zero ("+2:13") so meetings and talks can see how far over they are.
    display.text = formatOvertime(countdown.overtimeMs(now));
    display.html = display.text;
  }
  const status = statusText(display.phase, countdown.paused);
  const ends = endsText(display.phase, countdown.paused, now + remainingMs);
  const renderKey = [display.html, status, ends, scale, countdown.overtime].join('|');
  if (renderKey === state.lastRenderKey) return;
  state.lastRenderKey = renderKey;

  body.dataset.phase = display.phase;
  body.classList.toggle('paused', countdown.paused && display.phase !== 'done');
  body.classList.toggle('overtime', countdown.overtime);
  el.overtimeButton.setAttribute('aria-pressed', String(countdown.overtime));
  el.clock.style.setProperty('--size', clockFontSize(display.text, scale));
  el.clock.innerHTML = display.html; // built only from numbers in formatRemaining
  el.status.textContent = status;
  el.ends.textContent = ends;
  el.pauseButton.innerHTML = countdown.paused ? ICONS.play : ICONS.pause;

  const label = display.phase !== 'done' ? display.text
    : countdown.overtime ? `Time’s up ${display.text}` : 'Time’s up';
  document.title = countdown.title ? `${label} · ${countdown.title}` : label;
}

/** Small, short-lived confirmation in the corner, easy to miss for the audience. */
function showNote(text, durationMs = NOTE_VISIBLE_MS) {
  el.note.textContent = text;
  el.note.classList.add('visible');
  clearTimeout(state.noteId);
  state.noteId = setTimeout(() => el.note.classList.remove('visible'), durationMs);
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
  'toggle-overtime': toggleOvertime,
  'cycle-theme': cycleTheme,
  'toggle-fullscreen': toggleFullscreen,
  stop: requestStop,
  'move-up': moveUp,
  'move-down': moveDown,
  shrink,
  grow,
  'reset-layout': resetLayout,
  'close-layout': closeLayout,
  'toggle-help': toggleHelp,
  'close-help': closeHelp,
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
  o: toggleOvertime,
  f: toggleFullscreen,
  t: cycleTheme,
  r: requestStop,
};

const SHIFT_KEYS = {
  arrowup: moveUp,
  arrowdown: moveDown,
  b: () => addBuffer(-1),
};

function keyAction(event) {
  const key = event.key.toLowerCase();
  if (key === '?') return toggleHelp; // Shift+/ on most layouts, so check before the Shift keys
  if (key === 'escape' && isHelpOpen()) return closeHelp;
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

/** Touch alternative to B: long-press the clock to add a minute (no visible button). */
function bindLongPress() {
  let pressId = 0;
  let start = { x: 0, y: 0 };
  const cancel = () => clearTimeout(pressId);

  el.face.addEventListener('pointerdown', (event) => {
    if (!state.countdown || isLayoutMode()) return;
    start = { x: event.clientX, y: event.clientY };
    cancel();
    pressId = setTimeout(() => addBuffer(1), LONG_PRESS_MS);
  });
  el.face.addEventListener('pointermove', (event) => {
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.face.addEventListener(type, cancel);
  el.face.addEventListener('contextmenu', (event) => event.preventDefault());
}

function bindEvents() {
  el.form.addEventListener('submit', handleSubmit);
  el.presets.addEventListener('click', handlePresetClick);
  el.presets.addEventListener('dblclick', handlePresetDoubleClick);
  el.durationInput.addEventListener('input', () => {
    el.untilInput.value = '';
    updateLengthHint();
  });
  el.untilInput.addEventListener('input', updateLengthHint);
  setInterval(() => { if (!state.countdown) updateLengthHint(); }, LENGTH_HINT_REFRESH_MS);
  bindLongPress();
  el.copyLink.addEventListener('click', copyShareLink);
  el.themeChoices.forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  });

  el.timer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) BUTTON_ACTIONS[button.dataset.action]?.();
    else if (event.target === el.help) closeHelp(); // click on the backdrop
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
  updateLengthHint();
  bindEvents();
  setScale(Number(storage.get('scale')) || SCALE.initial, { announce: false });
  setOffset(Number(storage.get('offset')) || OFFSET.initial, { announce: false });
  resumeSavedCountdown();
}

init();

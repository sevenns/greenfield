// Settings-window renderer (Fluent UI Web Components v3, dark theme). No gamepad / hero / audio — this
// is the plain "system settings" UI: app version + update management.
//
// Fluent import channel (I-F1 fallback per plan §6.6): web-components.min.js turned out to export
// NOTHING (a pure side-effect bundle), so we can't take setTheme from it. Instead we use the single
// `.`-index resolution graph — pointed `*/define.js` side-effect imports register just the elements we
// use, and setTheme comes from the same `@fluentui/web-components` index. One FAST copy, smaller bundle.
import '@fluentui/web-components/text/define.js';
import '@fluentui/web-components/button/define.js';
import '@fluentui/web-components/field/define.js';
import '@fluentui/web-components/radio/define.js';
import '@fluentui/web-components/radio-group/define.js';
import '@fluentui/web-components/progress-bar/define.js';
import { setTheme } from '@fluentui/web-components';
import { webDarkTheme, webLightTheme } from '@fluentui/tokens';
import type { AutoUpdateMode, ThemeMode, UpdateStatus } from '../shared/types';

// ── Theme ────────────────────────────────────────────────────────────────────
// setTheme publishes the theme tokens as global CSS custom properties (see settings.css). `system`
// follows the OS preference via matchMedia and re-applies on OS changes; `light`/`dark` are fixed.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let systemListener: (() => void) | null = null;

function isDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && darkQuery.matches);
}

function paint(dark: boolean): void {
  setTheme(dark ? webDarkTheme : webLightTheme);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  // Keep the native caption buttons (min/max/close) in sync with the effective theme.
  window.settingsApi.setTitleBarDark(dark);
}

function applyTheme(mode: ThemeMode): void {
  paint(isDark(mode));
  // Only keep an OS-change subscription alive in `system` mode.
  if (systemListener !== null) {
    darkQuery.removeEventListener('change', systemListener);
    systemListener = null;
  }
  if (mode === 'system') {
    systemListener = () => paint(darkQuery.matches);
    darkQuery.addEventListener('change', systemListener);
  }
}

// Apply a best-guess theme immediately (before settings load) to avoid a flash of unstyled tokens.
applyTheme('system');

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} not found`);
  return el as T;
}

const titlebarIcon = req<HTMLImageElement>('titlebar-icon');
const titlebarVersion = req('titlebar-version');
const statusEl = req('update-status');
const progressEl = req('update-progress');
const actionBtn = req('update-action');
const radioGroup = req('auto-update');
const themeGroup = req('theme');
const openLogsBtn = req('open-logs');
const openGamesBtn = req('open-games');

// Fluent custom elements reflect `disabled` / `value` as attributes/properties not present on the
// HTMLElement type; narrow casts (never `any`) keep this typed without pulling the element classes in.
function setDisabled(el: HTMLElement, disabled: boolean): void {
  if (disabled) el.setAttribute('disabled', '');
  else el.removeAttribute('disabled');
}

function readAutoUpdateValue(el: HTMLElement): AutoUpdateMode | null {
  const raw = (el as HTMLElement & { value?: unknown }).value;
  return raw === 'download' || raw === 'download-install' || raw === 'off' ? raw : null;
}

function readThemeValue(el: HTMLElement): ThemeMode | null {
  const raw = (el as HTMLElement & { value?: unknown }).value;
  return raw === 'system' || raw === 'light' || raw === 'dark' ? raw : null;
}

function setGroupValue(el: HTMLElement, value: string): void {
  (el as HTMLElement & { value?: string }).value = value;
}

// Fluent v3 (its @fluentui/tokens is still alpha) radio-group intermittently leaves a radio — usually
// the last one — in a transient `:state(disabled)` on first paint: it looks greyed until you hover or
// select it. We never disable these radios, so clear any stuck disabled state. Toggling the property
// true→false guarantees the change is observed even if only the visual state (not the property) is
// stuck. Runs on both groups (all fluent-radio) after the values are set.
function clearStuckRadioDisabled(): void {
  const radios = document.querySelectorAll<HTMLElement & { disabled: boolean }>('fluent-radio');
  radios.forEach((radio) => {
    // Skip the checked radio: toggling `disabled` on it would make the group drop the selection
    // (disabledRadioHandler clears checkedIndex when a checked radio becomes disabled). The stuck one is
    // always an UNchecked radio anyway.
    if (radio.matches(':state(disabled)') && !radio.matches(':state(checked)')) {
      radio.disabled = true;
      radio.disabled = false;
    }
  });
}

// The context-dependent primary button action for the current status (null = the button is disabled
// or hidden). A single click listener dispatches to it, so render() only swaps label + handler.
let currentAction: (() => void) | null = null;

function showAction(label: string, handler: (() => void) | null, disabled = false): void {
  actionBtn.hidden = false;
  actionBtn.textContent = label;
  setDisabled(actionBtn, disabled || handler === null);
  currentAction = handler;
}

function hideAction(): void {
  actionBtn.hidden = true;
  currentAction = null;
}

function render(status: UpdateStatus): void {
  progressEl.hidden = true;
  switch (status.kind) {
    case 'idle':
      statusEl.textContent = 'Check for updates to see if a new version is available.';
      showAction('Check for updates', () => window.settingsApi.checkForUpdates());
      break;
    case 'not-available':
      statusEl.textContent = 'You’re up to date.';
      showAction('Check for updates', () => window.settingsApi.checkForUpdates());
      break;
    case 'checking':
      statusEl.textContent = 'Checking for updates…';
      showAction('Checking…', null, true);
      break;
    case 'available':
      statusEl.textContent = `Update available: ${status.version}`;
      showAction(`Update to ${status.version}`, () => window.settingsApi.downloadUpdate());
      break;
    case 'downloading':
      statusEl.textContent = `Downloading… ${status.percent}%`;
      progressEl.hidden = false;
      progressEl.setAttribute('value', String(status.percent));
      showAction('Downloading…', null, true);
      break;
    case 'downloaded':
      statusEl.textContent = `Update ${status.version} is ready to install.`;
      showAction('Restart & install', () => window.settingsApi.installUpdate());
      break;
    case 'error':
      statusEl.textContent = status.message;
      showAction('Retry', () => window.settingsApi.checkForUpdates());
      break;
    case 'unsupported':
      statusEl.textContent = 'Updates are available only in the installed build.';
      hideAction();
      break;
  }
}

actionBtn.addEventListener('click', () => {
  currentAction?.();
});

radioGroup.addEventListener('change', () => {
  const value = readAutoUpdateValue(radioGroup);
  if (value !== null) window.settingsApi.setAutoUpdate(value);
});

themeGroup.addEventListener('change', () => {
  const value = readThemeValue(themeGroup);
  if (value !== null) {
    applyTheme(value); // apply live for instant feedback
    window.settingsApi.setTheme(value); // and persist
  }
});

openLogsBtn.addEventListener('click', () => window.settingsApi.openLogs());
openGamesBtn.addEventListener('click', () => window.settingsApi.openGamesFolder());

async function init(): Promise<void> {
  // I3: subscribe BEFORE requesting the initial snapshot, so a push arriving in between isn't lost.
  window.settingsApi.onUpdateStatus(render);
  const [version, icon, settings, status] = await Promise.all([
    window.settingsApi.getAppVersion(),
    window.settingsApi.getAppIcon(),
    window.settingsApi.getSettings(),
    window.settingsApi.requestUpdateStatus(),
  ]);
  // Title bar: [icon] Playhook (version). Hide the <img> if the icon couldn't be read (empty string).
  if (icon !== '') titlebarIcon.src = icon;
  else titlebarIcon.hidden = true;
  titlebarVersion.textContent = `(${version})`;
  setGroupValue(radioGroup, settings.autoUpdate);
  setGroupValue(themeGroup, settings.theme);
  applyTheme(settings.theme);
  render(status);
  // Clear the Fluent radio-group first-paint disabled glitch (see clearStuckRadioDisabled). Two frames:
  // the stuck state can appear a frame after the values are set.
  requestAnimationFrame(() => {
    clearStuckRadioDisabled();
    requestAnimationFrame(clearStuckRadioDisabled);
  });
}

void init();

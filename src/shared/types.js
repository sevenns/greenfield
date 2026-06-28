// Общий контракт между main, preload и renderer.
// Только типы — файл компилируется в пустой JS и не создаёт runtime-зависимостей,
// поэтому renderer может импортировать отсюда через `import type` без require.
/** Имя приложения — корень каталога состояния в %APPDATA%. */
export const APP_NAME = 'microsd-game-launcher';
/** Имя файла-манифеста в корне карты. */
export const MANIFEST_FILENAME = 'game.json';
/** Имя файла-копии статистики на карте (best-effort). */
export const CARD_STATS_FILENAME = 'stats.json';
/** Каналы IPC (типизированный мост preload). */
export const IPC = {
    /** main → renderer: реплика текущего AppState. */
    stateUpdate: 'state:update',
    /** renderer → main: запрос текущего состояния (на старте окна). */
    stateRequest: 'state:request',
    /** renderer → main: пользователь нажал A / кликнул «Запуск». */
    actionLaunch: 'action:launch',
};
//# sourceMappingURL=types.js.map
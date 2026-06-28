// Launching the game and detecting when it closes (stage 6, A2/R4).
// We've settled on a direct self-contained .exe → the pid from spawn is stable. We watch for exit
// via the built-in `tasklist /FI "PID eq <pid>"` (no ps-list dependency and no ESM conflict),
// with debounce N=3. Process-polling is started ONLY by the controller and only in launching/running.
//
// Limitation (R4): from a non-elevated app, `tasklist` does NOT see an elevated process —
// a game with UAC will give a false "didn't start" timeout. For a direct .exe we assume the rights suffice.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type ResolvedManifest } from '../shared/types';

const execFileAsync = promisify(execFile);

const START_POLL_INTERVAL_MS = 1000;
const EXIT_POLL_INTERVAL_MS = 2500;
const EXIT_DEBOUNCE_READS = 3;

export class LaunchAbortedError extends Error {
  constructor() {
    super('launch wait aborted');
    this.name = 'LaunchAbortedError';
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new LaunchAbortedError();
}

/** Checks whether the process with the given pid is alive, via `tasklist`. Any error → treated as dead. */
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
      { windowsHide: true },
    );
    // The CSV line contains the pid in quotes: "image","<pid>",... Absence → "INFO: No tasks".
    return stdout.includes(`"${pid}"`);
  } catch {
    return false;
  }
}

/** Spawns the .exe and returns its pid. Throws if the process couldn't be created. */
export async function launchGame(manifest: ResolvedManifest): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(manifest.executablePath, [...manifest.raw.args], {
      cwd: manifest.cwd,
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      if (typeof child.pid !== 'number') {
        reject(new Error('process started without a pid'));
        return;
      }
      // From here we watch by pid via tasklist; we don't let the direct child reference keep
      // error handlers "dangling" — we remove the error listener.
      child.removeListener('error', reject);
      child.unref();
      resolve(child.pid);
    });
  });
}

/**
 * Waits for a live process to appear within `launchTimeoutSec`.
 * true — process is visible; false — timeout (false start / UAC).
 */
export async function waitForStart(
  pid: number,
  launchTimeoutSec: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + launchTimeoutSec * 1000;
  for (;;) {
    throwIfAborted(signal);
    if (await isProcessAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await delay(START_POLL_INTERVAL_MS);
  }
}

/**
 * Waits for the game to close: resolves after N=3 consecutive "process not found" reads (debounce).
 */
export async function waitForExit(pid: number, signal?: AbortSignal): Promise<void> {
  let missedReads = 0;
  for (;;) {
    throwIfAborted(signal);
    const alive = await isProcessAlive(pid);
    if (alive) {
      missedReads = 0;
    } else {
      missedReads += 1;
      if (missedReads >= EXIT_DEBOUNCE_READS) return;
    }
    await delay(EXIT_POLL_INTERVAL_MS);
  }
}

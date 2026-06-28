// Detecting card insertion/removal (stage 2, A1).
// The criterion for "our card" is NOT a bare diff over mountpoints (it's unreliable: the
// mountpoint lags on card readers), but the appearance of a removable/non-system volume that
// has a `game.json` in the root of one of its mountpoints. While the mountpoint is empty, scan
// simply returns null, and the polling itself acts as a retry until the volume letter appears.
import path from 'node:path';
import fse from 'fs-extra';
import { list } from 'drivelist';
import { MANIFEST_FILENAME } from '../shared/types';

const DEFAULT_INTERVAL_MS = 1000;

export class DriveWatcher {
  private timer: NodeJS.Timeout | null = null;
  private activeRoot: string | null = null;
  private scanning = false;

  private insertHandler: ((root: string) => void) | null = null;
  private removeHandler: ((root: string) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;

  constructor(private readonly intervalMs: number = DEFAULT_INTERVAL_MS) {}

  onInsert(handler: (root: string) => void): void {
    this.insertHandler = handler;
  }

  onRemove(handler: (root: string) => void): void {
    this.removeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** The current root of the active card, or null. */
  getActiveRoot(): string | null {
    return this.activeRoot;
  }

  private async tick(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const found = await this.scan();
      if (found !== null && found !== this.activeRoot) {
        // Card swap without an intermediate empty tick: remove the old one first.
        if (this.activeRoot !== null) {
          const previous = this.activeRoot;
          this.activeRoot = null;
          this.removeHandler?.(previous);
        }
        this.activeRoot = found;
        this.insertHandler?.(found);
      } else if (found === null && this.activeRoot !== null) {
        const previous = this.activeRoot;
        this.activeRoot = null;
        this.removeHandler?.(previous);
      }
    } catch (cause) {
      this.errorHandler?.(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      this.scanning = false;
    }
  }

  /** Returns the root of the first removable/non-system volume with a valid `game.json`. */
  private async scan(): Promise<string | null> {
    const drives = await list();
    for (const drive of drives) {
      if (drive.isRemovable !== true || drive.isSystem === true) continue;
      // A disk may have several partitions/mountpoints (P7) — we iterate over all of them.
      for (const mount of drive.mountpoints) {
        if (typeof mount.path !== 'string' || mount.path.length === 0) continue;
        const manifestPath = path.join(mount.path, MANIFEST_FILENAME);
        if (await fse.pathExists(manifestPath)) {
          return mount.path;
        }
      }
    }
    return null;
  }
}

// Playtime tracking (stage 7, section 3).
// The source of truth is on the PC (PcStore). The copy to the card is best-effort: the card may
// be yanked, so losing the copy isn't critical and must not crash the flow.
import path from 'node:path';
import { CARD_STATS_FILENAME, type Stats } from '../shared/types';
import { type PcStore } from './pc-store';
import { writeFileAtomic } from './save-sync';

export class StatsService {
  constructor(private readonly store: PcStore) {}

  async read(id: string): Promise<Stats> {
    return this.store.readStats(id);
  }

  /** Records a finished session: += time, ++launches, lastPlayedAt = now. Writes to the PC. */
  async recordPlay(id: string, playSeconds: number): Promise<Stats> {
    const previous = await this.store.readStats(id);
    const delta = Math.max(0, Math.round(playSeconds));
    const next: Stats = {
      schemaVersion: 1,
      totalPlaySeconds: previous.totalPlaySeconds + delta,
      lastPlayedAt: new Date().toISOString(),
      launchCount: previous.launchCount + 1,
    };
    await this.store.writeStats(id, next);
    return next;
  }

  /** Best-effort copy of the statistics to the card root. Errors are only logged. */
  async copyToCard(cardRoot: string, stats: Stats): Promise<void> {
    const target = path.join(cardRoot, CARD_STATS_FILENAME);
    try {
      await writeFileAtomic(target, JSON.stringify(stats, null, 2));
    } catch (cause) {
      console.warn('[stats] failed to copy stats to card (best-effort):', cause);
    }
  }
}

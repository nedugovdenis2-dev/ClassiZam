export interface TrackHashData {
  hashes: Uint32Array;
  times: Uint32Array;
}

export interface MatchScore {
  trackId: string | null;
  matches: number;
}

interface TrackScoreState {
  smoothedOffsets: Map<number, number>;
  maxMatches: number;
}

/**
 * Accumulates exactly the same offset histogram as the legacy matcher, but only
 * processes each query hash once. The peak extraction, hashes, thresholds and
 * confidence calculation remain outside this class and are unchanged.
 */
export class IncrementalMatchEngine {
  private readonly scores = new Map<string, TrackScoreState>();

  constructor(
    private readonly database: Map<string, TrackHashData>,
    private readonly allowedTrackIds?: ReadonlySet<string>,
  ) {}

  add(queryHashes: Uint32Array, queryTimes: Uint32Array): MatchScore {
    if (queryHashes.length !== queryTimes.length) {
      throw new Error('Query hash and time arrays must have equal lengths');
    }

    for (const [trackId, trackData] of this.database.entries()) {
      if (this.allowedTrackIds && !this.allowedTrackIds.has(trackId)) continue;

      let score = this.scores.get(trackId);
      if (!score) {
        score = { smoothedOffsets: new Map(), maxMatches: 0 };
        this.scores.set(trackId, score);
      }

      const dbHashes = trackData.hashes;
      const dbTimes = trackData.times;

      for (let i = 0; i < queryHashes.length; i++) {
        const queryHash = queryHashes[i];
        const queryTime = queryTimes[i];

        let left = 0;
        let right = dbHashes.length - 1;
        let foundIndex = -1;

        while (left <= right) {
          const middle = (left + right) >> 1;
          const middleHash = dbHashes[middle];
          if (middleHash === queryHash) {
            foundIndex = middle;
            break;
          }
          if (middleHash < queryHash) left = middle + 1;
          else right = middle - 1;
        }

        if (foundIndex === -1) continue;

        let start = foundIndex;
        while (start > 0 && dbHashes[start - 1] === queryHash) start--;

        let end = foundIndex;
        while (end < dbHashes.length - 1 && dbHashes[end + 1] === queryHash) end++;

        // Preserve the legacy high-collision guard exactly.
        if (end - start >= 1000) continue;

        for (let j = start; j <= end; j++) {
          const offset = dbTimes[j] - queryTime;
          this.increment(score, offset);
          this.increment(score, offset - 1);
          this.increment(score, offset + 1);
        }
      }
    }

    let bestTrackId: string | null = null;
    let maxMatches = 0;

    // Database insertion order is retained so legacy tie-breaking is retained.
    for (const [trackId] of this.database.entries()) {
      if (this.allowedTrackIds && !this.allowedTrackIds.has(trackId)) continue;
      const trackMatches = this.scores.get(trackId)?.maxMatches ?? 0;
      if (trackMatches > maxMatches) {
        maxMatches = trackMatches;
        bestTrackId = trackId;
      }
    }

    return { trackId: bestTrackId, matches: maxMatches };
  }

  private increment(score: TrackScoreState, offset: number) {
    const next = (score.smoothedOffsets.get(offset) ?? 0) + 1;
    score.smoothedOffsets.set(offset, next);
    if (next > score.maxMatches) score.maxMatches = next;
  }
}

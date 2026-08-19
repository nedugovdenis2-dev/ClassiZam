import assert from 'node:assert/strict';
import test from 'node:test';
import { IncrementalMatchEngine, MatchScore, TrackHashData } from '../src/services/matchEngine';

function legacyMatch(
  database: Map<string, TrackHashData>,
  allowedTrackIds: ReadonlySet<string>,
  queryHashes: Uint32Array,
  queryTimes: Uint32Array,
): MatchScore {
  const trackScores = new Map<string, Map<number, number>>();

  for (const [trackId, trackData] of database.entries()) {
    if (!allowedTrackIds.has(trackId)) continue;
    const offsets = new Map<number, number>();

    for (let i = 0; i < queryHashes.length; i++) {
      const queryHash = queryHashes[i];
      const queryTime = queryTimes[i];
      let left = 0;
      let right = trackData.hashes.length - 1;
      let foundIndex = -1;

      while (left <= right) {
        const middle = (left + right) >> 1;
        const middleHash = trackData.hashes[middle];
        if (middleHash === queryHash) {
          foundIndex = middle;
          break;
        }
        if (middleHash < queryHash) left = middle + 1;
        else right = middle - 1;
      }

      if (foundIndex === -1) continue;
      let start = foundIndex;
      while (start > 0 && trackData.hashes[start - 1] === queryHash) start--;
      let end = foundIndex;
      while (end < trackData.hashes.length - 1 && trackData.hashes[end + 1] === queryHash) end++;

      if (end - start < 1000) {
        for (let j = start; j <= end; j++) {
          const offset = trackData.times[j] - queryTime;
          offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
        }
      }
    }

    if (offsets.size > 0) trackScores.set(trackId, offsets);
  }

  let trackId: string | null = null;
  let matches = 0;
  for (const [candidateTrackId, offsets] of trackScores.entries()) {
    const smoothed = new Map<number, number>();
    for (const [offset, count] of offsets.entries()) {
      smoothed.set(offset, (smoothed.get(offset) ?? 0) + count);
      smoothed.set(offset - 1, (smoothed.get(offset - 1) ?? 0) + count);
      smoothed.set(offset + 1, (smoothed.get(offset + 1) ?? 0) + count);
    }
    for (const count of smoothed.values()) {
      if (count > matches) {
        matches = count;
        trackId = candidateTrackId;
      }
    }
  }

  return { trackId, matches };
}

function append(left: Uint32Array, right: Uint32Array) {
  const result = new Uint32Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function createTrack(seed: number, length: number): TrackHashData {
  let value = seed >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value;
  };
  const pairs = Array.from({ length }, () => ({
    hash: random() % 120,
    time: random() % 800,
  })).sort((a, b) => a.hash - b.hash || a.time - b.time);
  return {
    hashes: Uint32Array.from(pairs, pair => pair.hash),
    times: Uint32Array.from(pairs, pair => pair.time),
  };
}

test('incremental scores equal legacy cumulative scores after every batch', () => {
  const database = new Map<string, TrackHashData>([
    ['track-a', createTrack(1, 700)],
    ['track-b', createTrack(2, 650)],
    ['orphaned-track', createTrack(3, 500)],
  ]);
  const allowed = new Set(['track-a', 'track-b']);
  const engine = new IncrementalMatchEngine(database, allowed);

  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  const allHashes = Uint32Array.from({ length: 480 }, () => random() % 140);
  const allTimes = Uint32Array.from({ length: 480 }, () => random() % 900);

  let cumulativeHashes = new Uint32Array();
  let cumulativeTimes = new Uint32Array();
  let cursor = 0;
  for (const batchLength of [17, 63, 101, 129, 170]) {
    const hashBatch = allHashes.slice(cursor, cursor + batchLength);
    const timeBatch = allTimes.slice(cursor, cursor + batchLength);
    cursor += batchLength;
    cumulativeHashes = append(cumulativeHashes, hashBatch);
    cumulativeTimes = append(cumulativeTimes, timeBatch);

    assert.deepEqual(
      engine.add(hashBatch, timeBatch),
      legacyMatch(database, allowed, cumulativeHashes, cumulativeTimes),
    );
  }
});

test('legacy tie order and high-collision guard are preserved', () => {
  const repeatedHashes = new Uint32Array(1001).fill(99);
  const repeatedTimes = Uint32Array.from({ length: 1001 }, (_, index) => index);
  const shared: TrackHashData = {
    hashes: Uint32Array.from([10, 10, 20, 30]),
    times: Uint32Array.from([5, 15, 25, 35]),
  };
  const database = new Map<string, TrackHashData>([
    ['first', shared],
    ['second', shared],
    ['collision', { hashes: repeatedHashes, times: repeatedTimes }],
  ]);
  const allowed = new Set(database.keys());
  const engine = new IncrementalMatchEngine(database, allowed);
  const hashes = Uint32Array.from([10, 20, 30, 99]);
  const times = Uint32Array.from([1, 21, 31, 0]);

  assert.deepEqual(engine.add(hashes, times), legacyMatch(database, allowed, hashes, times));
  assert.equal(engine.add(new Uint32Array(), new Uint32Array()).trackId, 'first');
});

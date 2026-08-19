import { get, set, keys, del } from 'idb-keyval';
import { IncrementalMatchEngine, TrackHashData } from './matchEngine';

// trackId -> { hashes: Uint32Array, times: Uint32Array }
let cachedHashes: Map<string, TrackHashData> | null = null;
let matchEngine: IncrementalMatchEngine | null = null;

async function getHashes() {
  if (cachedHashes) return cachedHashes;
  
  cachedHashes = new Map();
  const allKeys = await keys();
  
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith('track_hashes_v2_')) {
      const trackId = key.replace('track_hashes_v2_', '');
      const data = await get(key);
      if (data) {
        cachedHashes.set(trackId, data);
      }
    }
  }
  
  // We should clear old v1 data to free up space
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith('track_hashes_') && !key.startsWith('track_hashes_v2_')) {
      await del(key);
    }
  }
  await del('hashes_array');
  
  return cachedHashes;
}

self.onmessage = async (e) => {
  const { type, payload, id } = e.data;
  
  try {
    if (type === 'LOAD') {
      await getHashes();
      self.postMessage({ id, type: 'SUCCESS' });
    } else if (type === 'SAVE') {
      const { trackId, hashArray, timeArray } = payload;
      
      const data = { hashes: hashArray, times: timeArray };
      await set(`track_hashes_v2_${trackId}`, data);
      
      if (cachedHashes) {
        cachedHashes.set(trackId, data);
      }
      
      self.postMessage({ id, type: 'SUCCESS' });
    } else if (type === 'REMOVE_TRACK') {
      const trackId = payload.trackId;
      await del(`track_hashes_v2_${trackId}`);
      if (cachedHashes) {
        cachedHashes.delete(trackId);
      }
      self.postMessage({ id, type: 'SUCCESS' });
    } else if (type === 'RESET_MATCH') {
      const dbHashes = await getHashes();
      const allowedTrackIds = new Set<string>(payload.trackIds);
      matchEngine = new IncrementalMatchEngine(dbHashes, allowedTrackIds);
      self.postMessage({ id, type: 'SUCCESS' });
    } else if (type === 'MATCH_INCREMENTAL') {
      const qHashArray = payload.queryHashArray;
      const qTimeArray = payload.queryTimeArray;
      const dbHashes = await getHashes();
      if (!matchEngine) matchEngine = new IncrementalMatchEngine(dbHashes);

      const score = matchEngine.add(qHashArray, qTimeArray);
      const match = score.trackId && score.matches > 15
        ? { track: { id: score.trackId }, matches: score.matches }
        : null;
      
      self.postMessage({ id, type: 'SUCCESS', payload: match });
    } else if (type === 'CLEAR') {
      const allKeys = await keys();
      for (const key of allKeys) {
        if (typeof key === 'string' && (key.startsWith('track_hashes_') || key.startsWith('track_hashes_v2_'))) {
          await del(key);
        }
      }
      await del('hashes_array');
      cachedHashes = null;
      matchEngine = null;
      self.postMessage({ id, type: 'SUCCESS' });
    }
  } catch (err) {
    self.postMessage({ id, type: 'ERROR', error: String(err) });
  }
};

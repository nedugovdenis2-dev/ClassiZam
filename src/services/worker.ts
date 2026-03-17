import { get, set, keys, del } from 'idb-keyval';

// trackId -> { hashes: Uint32Array, times: Uint32Array }
let cachedHashes: Map<string, { hashes: Uint32Array, times: Uint32Array }> | null = null;

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
    } else if (type === 'MATCH') {
      const qHashArray = payload.queryHashArray;
      const qTimeArray = payload.queryTimeArray;
      const tracks = payload.tracks;
      const dbHashes = await getHashes();
      
      console.log(`Worker MATCH: queryHashes=${qHashArray.length}, dbTracks=${dbHashes.size}, tracks=${tracks.length}`);
      
      const trackScores = new Map<string, Map<number, number>>();
      
      for (const [trackId, trackData] of dbHashes.entries()) {
        const dbHashArray = trackData.hashes;
        const dbTimeArray = trackData.times;
        const offsets = new Map<number, number>();
        
        for (let i = 0; i < qHashArray.length; i++) {
          const qHash = qHashArray[i];
          const qTime = qTimeArray[i];
          
          let left = 0;
          let right = dbHashArray.length - 1;
          let foundIdx = -1;
          
          while (left <= right) {
            const mid = (left + right) >> 1;
            const midHash = dbHashArray[mid];
            if (midHash === qHash) {
              foundIdx = mid;
              break;
            } else if (midHash < qHash) {
              left = mid + 1;
            } else {
              right = mid - 1;
            }
          }
          
          if (foundIdx !== -1) {
            let start = foundIdx;
            while (start > 0 && dbHashArray[start - 1] === qHash) start--;
            
            let end = foundIdx;
            while (end < dbHashArray.length - 1 && dbHashArray[end + 1] === qHash) end++;
            
            if (end - start < 1000) {
              for (let j = start; j <= end; j++) {
                const dbTime = dbTimeArray[j];
                const offset = dbTime - qTime;
                offsets.set(offset, (offsets.get(offset) || 0) + 1);
              }
            }
          }
        }
        
        if (offsets.size > 0) {
          trackScores.set(trackId, offsets);
        }
      }
      
      let bestTrackId = null;
      let maxMatches = 0;
      
      for (const [trackId, offsets] of trackScores.entries()) {
        const smoothed = new Map<number, number>();
        for (const [offset, count] of offsets.entries()) {
          smoothed.set(offset, (smoothed.get(offset) || 0) + count);
          smoothed.set(offset - 1, (smoothed.get(offset - 1) || 0) + count);
          smoothed.set(offset + 1, (smoothed.get(offset + 1) || 0) + count);
        }

        for (const count of smoothed.values()) {
          if (count > maxMatches) {
            maxMatches = count;
            bestTrackId = trackId;
          }
        }
      }
      
      let match = null;
      if (bestTrackId && maxMatches > 15) {
        const track = tracks.find((t: any) => t.id === bestTrackId);
        if (track) {
          match = { track, matches: maxMatches };
        }
      }
      
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
      self.postMessage({ id, type: 'SUCCESS' });
    }
  } catch (err) {
    self.postMessage({ id, type: 'ERROR', error: String(err) });
  }
};

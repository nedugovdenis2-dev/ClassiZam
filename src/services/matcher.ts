import { getTracks } from './db';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let messageId = 0;

function sendToWorker(type: string, payload?: any, transfer: Transferable[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    
    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        worker.removeEventListener('message', handler);
        if (e.data.type === 'ERROR') {
          reject(new Error(e.data.error));
        } else {
          resolve(e.data.payload);
        }
      }
    };
    
    worker.addEventListener('message', handler);
    worker.postMessage({ id, type, payload }, transfer);
  });
}

export async function preloadHashes() {
  await sendToWorker('LOAD');
}

export async function saveHashesWorker(trackId: string, hashArray: Uint32Array, timeArray: Uint32Array) {
  await sendToWorker(
    'SAVE',
    { trackId, hashArray, timeArray },
    [hashArray.buffer, timeArray.buffer],
  );
}

export async function removeHashesWorker(trackId: string) {
  await sendToWorker('REMOVE_TRACK', { trackId });
}

export async function clearHashesWorker() {
  await sendToWorker('CLEAR');
}

export async function resetMatchWorker() {
  const tracks = await getTracks();
  await sendToWorker('RESET_MATCH', { trackIds: tracks.map(track => track.id) });
}

export async function matchHashes(queryHashArray: Uint32Array, queryTimeArray: Uint32Array) {
  return sendToWorker(
    'MATCH_INCREMENTAL',
    { queryHashArray, queryTimeArray },
    [queryHashArray.buffer, queryTimeArray.buffer],
  );
}

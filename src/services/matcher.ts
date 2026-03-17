import { getTracks } from './db';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let messageId = 0;

function sendToWorker(type: string, payload?: any): Promise<any> {
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
    worker.postMessage({ id, type, payload });
  });
}

export async function preloadHashes() {
  await sendToWorker('LOAD');
}

export async function saveHashesWorker(trackId: string, hashArray: Uint32Array, timeArray: Uint32Array) {
  await sendToWorker('SAVE', { trackId, hashArray, timeArray });
}

export async function removeHashesWorker(trackId: string) {
  await sendToWorker('REMOVE_TRACK', { trackId });
}

export async function clearHashesWorker() {
  await sendToWorker('CLEAR');
}

export async function matchHashes(queryHashArray: Uint32Array, queryTimeArray: Uint32Array) {
  const tracks = await getTracks();
  return sendToWorker('MATCH', { 
    queryHashArray,
    queryTimeArray,
    tracks 
  });
}

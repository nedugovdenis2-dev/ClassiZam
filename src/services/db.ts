import { get, set } from 'idb-keyval';

export interface Track {
  id: string;
  name: string;
  duration: number;
  maxPeaks: number;
  audioBlob?: Blob;
}

export interface HashPoint {
  trackId: string;
  time: number;
}

export async function getTracks(): Promise<Track[]> {
  return (await get('tracks')) || [];
}

export async function saveTrack(track: Track) {
  const tracks = await getTracks();
  tracks.push(track);
  await set('tracks', tracks);
}

export async function removeTrack(trackId: string) {
  const tracks = await getTracks();
  const updated = tracks.filter(t => t.id !== trackId);
  await set('tracks', updated);
}

export async function clearDb() {
  await set('tracks', []);
}

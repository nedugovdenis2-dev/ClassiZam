import { create } from 'zustand';
import { Track, getTracks, saveTrack, removeTrack as removeTrackDb, clearDb } from './services/db';
import { getAudioBuffer, extractPeaks, generateHashes, applyPreEmphasis, normalize, resampleAudio } from './services/fingerprint';
import { saveHashesWorker, removeHashesWorker, clearHashesWorker } from './services/matcher';
import { get, set as setDb } from 'idb-keyval';

export type AppState = 'IDLE' | 'RECORDING' | 'ANALYZING' | 'MATCH_FOUND' | 'NO_MATCH' | 'ERROR';

interface Store {
  state: AppState;
  tracks: Track[];
  volume: number;
  confidence: number;
  matchedTrack: Track | null;
  intermediateTrack: Track | null;
  intermediateConfidence: number;
  errorMessage: string | null;
  guessedTrackIds: string[];
  loadTracks: () => Promise<void>;
  addTrack: (file: File) => Promise<void>;
  removeTrack: (trackId: string) => Promise<void>;
  clearTracks: () => Promise<void>;
  setState: (state: AppState) => void;
  setError: (msg: string) => void;
  setVolume: (volume: number) => void;
  setMatch: (track: Track | null, confidence: number) => void;
  setIntermediateMatch: (track: Track | null, confidence: number) => void;
  markAsGuessed: (trackId: string) => void;
  resetLesson: () => void;
}

export const useStore = create<Store>((set) => ({
  state: 'IDLE',
  tracks: [],
  volume: 0,
  confidence: 0,
  matchedTrack: null,
  intermediateTrack: null,
  intermediateConfidence: 0,
  errorMessage: null,
  guessedTrackIds: [],
  
  loadTracks: async () => {
    const version = await get('db_version');
    if (version !== 32) {
      await clearDb();
      await clearHashesWorker();
      await setDb('db_version', 32);
    }
    const tracks = await getTracks();
    set({ tracks });
  },
  
  addTrack: async (file: File) => {
    const trackName = file.name.replace(/\.[^/.]+$/, "");
    const existingTracks = await getTracks();
    if (existingTracks.some(t => t.name === trackName)) {
      set({ state: 'ERROR', errorMessage: 'Этот трек уже есть в базе данных' });
      return;
    }

    set({ state: 'ANALYZING', errorMessage: null });
    try {
      let buffer = await getAudioBuffer(file);
      if (buffer.sampleRate !== 22050) {
        console.log("Resampling file from", buffer.sampleRate, "to 22050");
        buffer = await resampleAudio(buffer, 22050);
      }
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        normalize(buffer.getChannelData(c));
      }
      applyPreEmphasis(buffer);
      const peaks = await extractPeaks(buffer);
      const trackId = crypto.randomUUID();
      const { hashArray, timeArray, peakCount, hashCount } = generateHashes(peaks, trackId);
      
      const track: Track = {
        id: trackId,
        name: trackName,
        duration: buffer.duration,
        maxPeaks: peakCount,
        audioBlob: file
      };
      
      await saveTrack(track);
      await saveHashesWorker(trackId, hashArray, timeArray);
      
      const tracks = await getTracks();
      set({ tracks, state: 'IDLE' });
    } catch (e) {
      console.error(e);
      set({ state: 'ERROR', errorMessage: 'Не удалось проанализировать трек' });
    }
  },

  removeTrack: async (trackId: string) => {
    // Optimistic update for instant UI feedback
    set((state) => ({ tracks: state.tracks.filter(t => t.id !== trackId) }));
    
    try {
      await removeTrackDb(trackId);
      await removeHashesWorker(trackId);
    } catch (e) {
      console.error("Failed to remove track", e);
    }
  },
  
  clearTracks: async () => {
    set({ tracks: [] });
    try {
      await clearDb();
      await clearHashesWorker();
    } catch (e) {
      console.error("Failed to clear tracks", e);
    }
  },
  
  setState: (state) => set({ state, errorMessage: state === 'IDLE' ? null : useStore.getState().errorMessage }),
  setError: (msg) => set({ state: 'ERROR', errorMessage: msg }),
  setVolume: (volume) => set({ volume }),
  setMatch: (track, confidence) => set((state) => {
    const newGuessedIds = track && !state.guessedTrackIds.includes(track.id) 
      ? [...state.guessedTrackIds, track.id] 
      : state.guessedTrackIds;
    return { 
      matchedTrack: track, 
      confidence, 
      intermediateTrack: null, 
      intermediateConfidence: 0,
      guessedTrackIds: newGuessedIds
    };
  }),
  setIntermediateMatch: (track, confidence) => set({ intermediateTrack: track, intermediateConfidence: confidence }),
  markAsGuessed: (trackId) => set((state) => ({
    guessedTrackIds: state.guessedTrackIds.includes(trackId) ? state.guessedTrackIds : [...state.guessedTrackIds, trackId]
  })),
  resetLesson: () => set({ guessedTrackIds: [] })
}));


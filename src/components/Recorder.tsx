import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { AudioRecorder } from '../services/recorder';
import { matchHashes, preloadHashes, resetMatchWorker } from '../services/matcher';
import { Mic, Square, Loader2, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function Recorder() {
  const state = useStore(store => store.state);
  const setState = useStore(store => store.setState);
  const setError = useStore(store => store.setError);
  const setMatch = useStore(store => store.setMatch);
  const setIntermediateMatch = useStore(store => store.setIntermediateMatch);
  const volume = useStore(store => store.volume);
  const setVolume = useStore(store => store.setVolume);
  const matchedTrack = useStore(store => store.matchedTrack);
  const confidence = useStore(store => store.confidence);
  const intermediateTrack = useStore(store => store.intermediateTrack);
  const intermediateConfidence = useStore(store => store.intermediateConfidence);
  const errorMessage = useStore(store => store.errorMessage);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  const currentStableTrackId = useRef<string | null>(null);
  const bestConfidence = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const isMatchingRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const recordingSessionRef = useRef(0);
  const lastVolumeUpdateRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSilent, setIsSilent] = useState(false);
  const isSilentRef = useRef(false);
  const MAX_TIME = 40; // Increased to 40 seconds
  
  const startRecording = async () => {
    const sessionId = ++recordingSessionRef.current;
    isRecordingRef.current = false;
    setMatch(null, 0);
    setIntermediateMatch(null, 0);
    setProgress(0);
    setElapsedTime(0);
    currentStableTrackId.current = null;
    bestConfidence.current = 0;
    isMatchingRef.current = false;
    
    // Show loading state while DB loads
    setState('ANALYZING');
    
    try {
      // Preload database into memory to prevent UI freeze during the first match
      await preloadHashes();
      await resetMatchWorker();
    } catch (e) {
      console.error("Failed to load DB", e);
      setError("Не удалось загрузить базу данных");
      return;
    }
    
    recorderRef.current = new AudioRecorder();
    
    let frameNumber = 0;
    let prev2 = new Float32Array(4096);
    let prev1 = new Float32Array(4096);
    
    // Keep only hashes that the worker has not processed yet. The worker retains
    // cumulative scores, so recognition results remain mathematically identical.
    let recentPeaks: { time: number, freqs: number[] }[] = [];
    let lastHashTime = 0;
    let pendingHashes: number[] = [];
    let pendingTimes: number[] = [];
    
    try {
      isRecordingRef.current = true;
      await recorderRef.current.start((freqData, rms) => {
        // Volume only drives UI animation; throttling it does not touch audio analysis.
        const now = performance.now();
        if (now - lastVolumeUpdateRef.current >= 66) {
          lastVolumeUpdateRef.current = now;
          setVolume(Math.min(1, rms * 5));
        }
        
        if (frameNumber >= 2) {
          const freqs: number[] = [];
          
          const sampleRateRatio = recorderRef.current!.getSampleRate() / 22050;
          const maxBin = Math.floor(1500 / sampleRateRatio);
          const minBin = Math.floor(40 / sampleRateRatio);
          
          let frameMax = -Infinity;
          for (let i = minBin; i < maxBin; i++) {
            if (prev1[i] > frameMax) frameMax = prev1[i];
          }
          
          // Lowered thresholds to capture distant music
          const currentIsSilent = rms < 0.001 || frameMax < -95;
          if (isSilentRef.current !== currentIsSilent) {
            isSilentRef.current = currentIsSilent;
            setIsSilent(currentIsSilent);
          }

          // Draw visualizer
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              const width = canvasRef.current.width;
              const height = canvasRef.current.height;
              
              // Shift left by 2 pixels
              ctx.drawImage(canvasRef.current, 2, 0, width - 2, height, 0, 0, width - 2, height);
              
              // Clear the rightmost 2 pixels
              ctx.fillStyle = '#0f172a'; // slate-900
              ctx.fillRect(width - 2, 0, 2, height);
            }
          }
          
          if (!currentIsSilent && frameMax > -120) {
            const threshold = Math.max(frameMax - 40, -120);
            const localPeaks: { bin: number, val: number }[] = [];
            
            for (let i = minBin; i < maxBin; i++) {
              const val = prev1[i];
              if (val > threshold) {
                if (val > prev2[i] && val >= freqData[i]) {
                  let isPeak = true;
                  const windowSize = Math.max(1, Math.round(5 / sampleRateRatio));
                  for (let j = 1; j <= windowSize; j++) {
                    if (val < prev1[i - j] || val <= prev1[i + j]) {
                      isPeak = false;
                      break;
                    }
                  }
                  if (isPeak) {
                    const alpha = prev1[i - 1];
                    const beta = val;
                    const gamma = prev1[i + 1];
                    let p = 0;
                    const denom = alpha - 2 * beta + gamma;
                    if (denom !== 0) {
                      p = 0.5 * (alpha - gamma) / denom;
                    }
                    const mappedBin = Math.round((i + p) * sampleRateRatio);
                    localPeaks.push({ bin: mappedBin, val: beta - 0.25 * (alpha - gamma) * p });
                  }
                }
              }
            }
            
            localPeaks.sort((a, b) => b.val - a.val);
            const topPeaks = localPeaks.slice(0, 8);
            for (const p of topPeaks) {
              freqs.push(p.bin);
            }
            
            // Draw peaks on canvas
            if (canvasRef.current && freqs.length > 0) {
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) {
                const height = canvasRef.current.height;
                const width = canvasRef.current.width;
                ctx.fillStyle = '#818cf8'; // indigo-400
                for (const bin of freqs) {
                  const y = height - (bin / 1500) * height;
                  ctx.beginPath();
                  ctx.arc(width - 2, y, 1.5, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }
          }
          
          if (freqs.length > 0) {
            const currentPeak = { time: (frameNumber - 1) / sampleRateRatio, freqs };
            
            // 1. Intra-frame hashing (capture chords)
            for (let k = 0; k < currentPeak.freqs.length; k++) {
              for (let l = k + 1; l < currentPeak.freqs.length; l++) {
                const f1 = currentPeak.freqs[k];
                const f2 = currentPeak.freqs[l];
                const m1 = Math.min(f1, f2);
                const m2 = Math.max(f1, f2);
                const hash = m1 | (m2 << 12) | (0 << 24);
                pendingHashes.push(hash);
                pendingTimes.push(Math.round(currentPeak.time));
              }
            }
            
            // 2. Inter-frame hashing (capture melody)
            for (let i = recentPeaks.length - 1; i >= 0; i--) {
              const p1 = recentPeaks[i];
              const dt = Math.round(currentPeak.time - p1.time);
              if (dt > 8) break;
              if (dt <= 0) continue;
              
              for (const f1 of p1.freqs) {
                for (const f2 of currentPeak.freqs) {
                  const hash = f1 | (f2 << 12) | (dt << 24);
                  pendingHashes.push(hash);
                  pendingTimes.push(Math.round(p1.time));
                }
              }
            }
            
            recentPeaks.push(currentPeak);
            // Keep peaks from the last 8 frames (in 22050Hz time)
            recentPeaks = recentPeaks.filter(p => currentPeak.time - p.time <= 8);
          }
        }
        
        prev2.set(prev1);
        prev1.set(freqData);
        frameNumber++;
        
        // Match every ~1 second (21 frames at 22050Hz)
        const framesPerSecond = 21 * (recorderRef.current!.getSampleRate() / 22050);
        if (frameNumber - lastHashTime >= framesPerSecond) {
          lastHashTime = frameNumber;
          
          if (pendingHashes.length > 0 && !isMatchingRef.current) {
              isMatchingRef.current = true;
              const queryHashArray = new Uint32Array(pendingHashes);
              const queryTimeArray = new Uint32Array(pendingTimes);
              pendingHashes = [];
              pendingTimes = [];

              matchHashes(queryHashArray, queryTimeArray).then(match => {
              if (recordingSessionRef.current !== sessionId || !isRecordingRef.current) return;
              if (match) {
                // match.matches is cumulative across the whole recording.
                // We expect the number of matches to grow over time.
                const elapsedSeconds = frameNumber / framesPerSecond;
                const expectedMatches = elapsedSeconds * 15; // Expect ~15 matches per second
                
                let conf = 0;
                if (match.matches >= 15) {
                  // Require at least 50 matches to reach 100% confidence
                  conf = Math.min(1, match.matches / Math.max(50, expectedMatches));
                }
                
                if (conf > 0.15) {
                  currentStableTrackId.current = match.track.id;
                  bestConfidence.current = conf;
                  const track = useStore.getState().tracks.find(t => t.id === match.track.id);
                  if (track) {
                    setIntermediateMatch(track, conf);
                  }
                } else {
                  setIntermediateMatch(null, 0);
                }
              } else {
                setIntermediateMatch(null, 0);
              }
            }).catch(err => {
              console.error("Worker match error:", err);
            }).finally(() => {
              if (recordingSessionRef.current === sessionId) {
                isMatchingRef.current = false;
              }
            });
          }
        }
      });
      
      setState('RECORDING');
      let seconds = 0;
      timerRef.current = window.setInterval(() => {
        seconds++;
        setElapsedTime(seconds);
        setProgress((seconds / MAX_TIME) * 100);
        if (seconds >= MAX_TIME) {
          stopRecording(true);
        }
      }, 1000);
    } catch (e) {
      isRecordingRef.current = false;
      console.error("Microphone error:", e);
      setError("Требуется доступ к микрофону. Пожалуйста, разрешите использование микрофона.");
      stopRecording(true);
    }
  };
  
  const stopRecording = (autoStop: boolean) => {
    isRecordingRef.current = false;
    recordingSessionRef.current++;
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setVolume(0);
    
    // If we're stopping because of an error, don't try to find a match
    if (useStore.getState().state === 'ERROR') {
      return;
    }
    
    if (currentStableTrackId.current) {
      const track = useStore.getState().tracks.find(t => t.id === currentStableTrackId.current);
      if (track) {
        setMatch(track, bestConfidence.current || 0.8);
        setState('MATCH_FOUND');
        return;
      }
    }
    
    setState('NO_MATCH');
  };
  
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      recordingSessionRef.current++;
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stop();
    };
  }, []);

  const getConfidenceColor = (conf: number) => {
    if (conf > 0.7) return 'text-emerald-400';
    if (conf > 0.4) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="flex flex-col items-center justify-center mt-12 gap-8 w-full">
      <div className="relative">
        {state === 'RECORDING' && (
          <motion.div 
            className="absolute inset-0 rounded-full bg-indigo-500/30 blur-xl"
            animate={{ scale: 1 + volume * 3 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.1 }}
          />
        )}
        
        <button
          onClick={state === 'RECORDING' ? () => stopRecording(false) : startRecording}
          disabled={state === 'ANALYZING'}
          className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
            state === 'RECORDING' 
              ? 'bg-red-500 hover:bg-red-600' 
              : 'bg-indigo-600 hover:bg-indigo-700'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {state === 'RECORDING' ? (
            <Square className="w-12 h-12 text-white fill-white" />
          ) : state === 'ANALYZING' ? (
            <Loader2 className="w-12 h-12 text-white animate-spin" />
          ) : (
            <Mic className="w-12 h-12 text-white" />
          )}
        </button>
        
        {state === 'RECORDING' && (
          <svg className="absolute -inset-4 w-[calc(100%+2rem)] h-[calc(100%+2rem)] pointer-events-none -rotate-90">
            <circle
              cx="50%"
              cy="50%"
              r="48%"
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="4"
            />
            <circle
              cx="50%"
              cy="50%"
              r="48%"
              fill="none"
              stroke="#6366f1"
              strokeWidth="4"
              strokeDasharray="300"
              strokeDashoffset={300 - (progress / 100) * 300}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
        )}
      </div>
      
      <div className="min-h-[16rem] flex items-center justify-center w-full max-w-md relative">
        <AnimatePresence mode="wait">
          {state === 'MATCH_FOUND' && matchedTrack && (
            <motion.div 
              key="match"
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className={`border rounded-2xl p-4 w-full text-center shadow-lg ${
                confidence >= 0.7 
                  ? 'bg-emerald-500/20 border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.2)]' 
                  : 'bg-yellow-500/20 border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.2)]'
              }`}
            >
              {confidence >= 0.7 ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              ) : (
                <HelpCircle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              )}
              <h3 className="text-xl font-bold text-white">
                {confidence >= 0.7 ? matchedTrack.name : `Лучшее совпадение: ${matchedTrack.name}`}
              </h3>
              <p className={`text-sm mt-1 ${confidence >= 0.7 ? 'text-emerald-300' : 'text-yellow-300'}`}>
                Уверенность: {(confidence * 100).toFixed(1)}%
              </p>
            </motion.div>
          )}
          
          {state === 'NO_MATCH' && (
            <motion.div 
              key="no-match"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-500/20 border border-red-500/30 rounded-2xl p-4 w-full text-center"
            >
              <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <h3 className="text-xl font-bold text-white">Совпадений не найдено</h3>
              <p className="text-red-300 text-sm mt-1">Попробуйте поднести микрофон ближе к источнику звука</p>
            </motion.div>
          )}

          {state === 'ERROR' && errorMessage && (
            <motion.div 
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-500/20 border border-red-500/30 rounded-2xl p-4 w-full text-center"
            >
              <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <h3 className="text-xl font-bold text-white">Ошибка</h3>
              <p className="text-red-300 text-sm mt-1">{errorMessage}</p>
            </motion.div>
          )}
          
          {state === 'RECORDING' && (
            <motion.div 
              key="recording"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full text-center flex flex-col items-center gap-4"
            >
              <div className="w-full relative rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900/50 h-20 shadow-inner">
                <canvas 
                  ref={canvasRef} 
                  width={300} 
                  height={80} 
                  className="w-full h-full opacity-80"
                />
                {isSilent && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm transition-all duration-300">
                    <span className="text-slate-400 text-sm font-medium tracking-widest uppercase">Слишком тихо</span>
                  </div>
                )}
              </div>

              {intermediateTrack ? (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 w-full backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-indigo-300" />
                      <span className="text-indigo-300 text-sm font-medium uppercase tracking-wider">В эфире:</span>
                    </div>
                    <span className="text-indigo-300/70 text-xs font-mono">{elapsedTime}с / {MAX_TIME}с</span>
                  </div>
                  <h4 className="text-lg font-semibold text-white truncate px-2">{intermediateTrack.name}</h4>
                  <div className="mt-3 w-full bg-black/40 rounded-full h-2 overflow-hidden">
                    <motion.div 
                      className={`h-full rounded-full ${intermediateConfidence > 0.7 ? 'bg-emerald-500' : intermediateConfidence > 0.4 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, intermediateConfidence * 100)}%` }}
                      transition={{ type: 'spring', bounce: 0 }}
                    />
                  </div>
                  <p className={`text-xs mt-2 font-mono ${getConfidenceColor(intermediateConfidence)}`}>
                    {(intermediateConfidence * 100).toFixed(1)}% совпадение
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-indigo-300 animate-pulse text-lg font-medium">Анализ аудио...</p>
                  <p className="text-indigo-300/70 text-sm font-mono">{elapsedTime}с / {MAX_TIME}с</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

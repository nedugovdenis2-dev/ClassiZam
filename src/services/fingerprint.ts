const TARGET_SAMPLE_RATE = 22050;
const FFT_SIZE = 8192;
const HOP_SIZE = 1024;
const IOS_DECODE_MEMORY_BUDGET = 192 * 1024 * 1024;
const IOS_MAX_COMPRESSED_FILE_SIZE = 96 * 1024 * 1024;

export class AudioImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioImportError';
  }
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function readAudioDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };

    const timeoutId = window.setTimeout(() => finish(null), 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : null;
      finish(duration);
    };
    audio.onerror = () => finish(null);
    audio.src = objectUrl;
  });
}

/** Prevents iOS Safari from killing the tab before decodeAudioData can reject. */
export async function validateAudioFileForImport(file: File) {
  if (!isIOSDevice()) return;

  if (file.size > IOS_MAX_COMPRESSED_FILE_SIZE) {
    throw new AudioImportError(
      `Файл «${file.name}» слишком большой для безопасного декодирования на iPhone. `
      + 'Обрежьте файл до первой минуты — ClassiZam всё равно строит отпечаток только по первым 60 секундам.',
    );
  }

  const duration = await readAudioDuration(file);
  if (duration === null) return;

  // Safari normally decodes music to stereo 48 kHz float PCM. Include the
  // compressed source buffer because both can coexist during decodeAudioData.
  const estimatedPeakBytes = duration * 48000 * 2 * Float32Array.BYTES_PER_ELEMENT + file.size;
  if (estimatedPeakBytes > IOS_DECODE_MEMORY_BUDGET) {
    const minutes = Math.max(1, Math.round(duration / 60));
    throw new AudioImportError(
      `Трек «${file.name}» длится около ${minutes} мин. Его полное декодирование может закрыть вкладку Safari. `
      + 'Обрежьте файл до первой минуты: используемый для распознавания фрагмент от этого не изменится.',
    );
  }
}

export async function getAudioBuffer(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

    const MAX_SECONDS = 60;
    if (decodedBuffer.duration > MAX_SECONDS) {
      const length = MAX_SECONDS * decodedBuffer.sampleRate;
      const offlineCtx = new OfflineAudioContext(
        decodedBuffer.numberOfChannels,
        length,
        decodedBuffer.sampleRate
      );
      const newBuffer = offlineCtx.createBuffer(
        decodedBuffer.numberOfChannels,
        length,
        decodedBuffer.sampleRate
      );
      for (let c = 0; c < decodedBuffer.numberOfChannels; c++) {
        newBuffer.copyToChannel(decodedBuffer.getChannelData(c).subarray(0, length), c);
      }
      return newBuffer;
    }

    return decodedBuffer;
  } catch (error) {
    if (error instanceof AudioImportError) throw error;
    throw new AudioImportError(
      `Не удалось декодировать «${file.name}». На iPhone попробуйте MP3 или AAC без DRM либо перекодируйте файл.`,
    );
  } finally {
    if (ctx.state !== 'closed') {
      await ctx.close().catch(() => undefined);
    }
  }
}

export async function resampleAudio(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
  if (audioBuffer.sampleRate === targetSampleRate) {
    return audioBuffer;
  }
  const offlineCtx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    Math.ceil(audioBuffer.duration * targetSampleRate),
    targetSampleRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  return await offlineCtx.startRendering();
}

export function getRMS(channelData: Float32Array) {
  let sum = 0;
  for (let i = 0; i < channelData.length; i++) {
    sum += channelData[i] * channelData[i];
  }
  return Math.sqrt(sum / channelData.length);
}

export function normalize(channelData: Float32Array) {
  let max = 0;
  for (let i = 0; i < channelData.length; i++) {
    if (Math.abs(channelData[i]) > max) max = Math.abs(channelData[i]);
  }
  if (max > 0) {
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] /= max;
    }
  }
}

export function applyPreEmphasis(audioBuffer: AudioBuffer, alpha: number = 0.97) {
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = channelData.length - 1; i > 0; i--) {
      channelData[i] = channelData[i] - alpha * channelData[i - 1];
    }
    channelData[0] = channelData[0] * (1 - alpha);
  }
}

export async function extractPeaks(audioBuffer: AudioBuffer) {
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  
  const analyser = offlineCtx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.0; // No smoothing to get crisp peaks
  analyser.minDecibels = -110;
  analyser.maxDecibels = 10; // Prevent clipping on loud normalized audio
  
  source.connect(analyser);
  analyser.connect(offlineCtx.destination);
  source.start(0);
  
  const hopTime = HOP_SIZE / audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  
  const peaks: { time: number, freqs: number[] }[] = [];
  
  let prev2 = new Float32Array(analyser.frequencyBinCount);
  let prev1 = new Float32Array(analyser.frequencyBinCount);
  let curr = new Float32Array(analyser.frequencyBinCount);
  
  let frameNumber = 0;
  let frameTime = HOP_SIZE;
  
  const scheduleNext = () => {
    const t = frameTime / audioBuffer.sampleRate;
    if (t < duration) {
      offlineCtx.suspend(t).then(() => {
        analyser.getFloatFrequencyData(curr);
        
        if (frameNumber >= 2) {
          const freqs: number[] = [];
          
          let frameMax = -Infinity;
          for (let i = 40; i < 1500; i++) {
            if (prev1[i] > frameMax) frameMax = prev1[i];
          }
          
          if (frameMax > -110) {
            const threshold = Math.max(frameMax - 40, -110);
            const localPeaks: { bin: number, val: number }[] = [];
            
            for (let i = 40; i < 1500; i++) {
              const val = prev1[i];
              if (val > threshold) {
                if (val > prev2[i] && val >= curr[i]) {
                  let isPeak = true;
                  for (let j = 1; j <= 5; j++) { // Wider local max window to prevent clustering
                    if (val < prev1[i - j] || val <= prev1[i + j]) {
                      isPeak = false;
                      break;
                    }
                  }
                  if (isPeak) {
                    localPeaks.push({ bin: i, val });
                  }
                }
              }
            }
            
            localPeaks.sort((a, b) => b.val - a.val);
            const topPeaks = localPeaks.slice(0, 8);
            for (const p of topPeaks) {
              freqs.push(p.bin);
            }
          }
          
          if (freqs.length > 0) {
            peaks.push({ time: frameNumber - 1, freqs });
          }
        }
        
        prev2.set(prev1);
        prev1.set(curr);
        frameNumber++;
        frameTime += HOP_SIZE;
        scheduleNext();
        offlineCtx.resume();
      }).catch(err => {
        console.error("Suspend error:", err);
        frameTime += HOP_SIZE;
        scheduleNext();
        offlineCtx.resume();
      });
    }
  };
  scheduleNext();
  await offlineCtx.startRendering();
  return peaks;
}

export function generateHashes(peaks: { time: number, freqs: number[] }[], trackId: string) {
  let hashCount = 0;
  let peakCount = 0;
  for (let i = 0; i < peaks.length; i++) {
    peakCount += peaks[i].freqs.length;
    const len = peaks[i].freqs.length;
    hashCount += (len * (len - 1)) / 2;
    for (let j = i + 1; j < peaks.length; j++) {
      if (peaks[j].time - peaks[i].time > 8) break;
      hashCount += len * peaks[j].freqs.length;
    }
  }
  
  const hashArray = new Uint32Array(hashCount);
  const timeArray = new Uint32Array(hashCount);
  let idx = 0;
  
  for (let i = 0; i < peaks.length; i++) {
    const p1 = peaks[i];
    
    // 1. Intra-frame hashing (capture chords/harmony)
    for (let k = 0; k < p1.freqs.length; k++) {
      for (let l = k + 1; l < p1.freqs.length; l++) {
        const m1 = Math.min(p1.freqs[k], p1.freqs[l]);
        const m2 = Math.max(p1.freqs[k], p1.freqs[l]);
        hashArray[idx] = m1 | (m2 << 12) | (0 << 24);
        timeArray[idx] = p1.time;
        idx++;
      }
    }
    
    // 2. Inter-frame hashing (capture melody/rhythm)
    for (let j = i + 1; j < peaks.length; j++) {
      const p2 = peaks[j];
      const dt = p2.time - p1.time;
      if (dt > 8) break; // Look ahead up to 8 frames (~350ms)
      
      for (const f1 of p1.freqs) {
        for (const f2 of p2.freqs) {
          hashArray[idx] = f1 | (f2 << 12) | (dt << 24);
          timeArray[idx] = p1.time;
          idx++;
        }
      }
    }
  }
  
  // Sort by hash using a combined Float64Array
  const combined = new Float64Array(hashCount);
  for (let i = 0; i < hashCount; i++) {
    combined[i] = hashArray[i] * 4294967296 + timeArray[i];
  }
  combined.sort();
  for (let i = 0; i < hashCount; i++) {
    const val = combined[i];
    hashArray[i] = Math.floor(val / 4294967296);
    timeArray[i] = val % 4294967296;
  }
  
  return { hashArray, timeArray, peakCount, hashCount };
}

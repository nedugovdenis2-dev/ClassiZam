export class AudioRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  
  async start(onFrame: (freqData: Float32Array, rms: number) => void) {
    this.ctx = new AudioContext({ sampleRate: 22050 });
    await this.ctx.resume();
    console.log("AudioContext sampleRate:", this.ctx.sampleRate, "state:", this.ctx.state);
    if (this.ctx.sampleRate !== 22050) {
      console.warn("AudioContext sample rate is not 22050! It is", this.ctx.sampleRate);
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    } });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    
    // Add a GainNode to boost the signal for distant music
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 3.0; // Boost signal by 3x (approx +9.5dB)
    
    // Apply pre-emphasis filter to match the database (y[n] = x[n] - 0.97 * x[n-1])
    const feedforward = [1, -0.97];
    const feedback = [1];
    const preEmphasisFilter = this.ctx.createIIRFilter(feedforward, feedback);
    
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.0;
    this.analyser.minDecibels = -130; // Lowered to capture quieter sounds
    this.analyser.maxDecibels = 10;
    
    this.processor = this.ctx.createScriptProcessor(1024, 1, 1);
    
    // Connect the audio graph: Source -> Gain -> Pre-emphasis -> Analyser -> Processor -> Destination
    this.source.connect(gainNode);
    gainNode.connect(preEmphasisFilter);
    preEmphasisFilter.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    
    const freqData = new Float32Array(this.analyser.frequencyBinCount);
    
    this.processor.onaudioprocess = (e) => {
      // Get perfectly synced FFT frame
      this.analyser!.getFloatFrequencyData(freqData);
      
      // Calculate RMS for UI volume
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);
      
      onFrame(freqData, rms);
    };
  }
  
  getSampleRate(): number {
    return this.ctx?.sampleRate || 22050;
  }

  stop() {
    if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.processor?.disconnect();
    this.analyser?.disconnect();
    this.source?.disconnect();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(err => console.warn('Failed to close AudioContext', err));
    }
    this.processor = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
  }
}

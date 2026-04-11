export interface MixSettings {
  vocalVolume: number;
  beatVolume: number;
  backupVolume: number;
  reverb: number;
  echo: number;
  saturation: number;
  doubler: number; // 0.0 to 1.0
  pitchCorrection: number; // 0.0 to 1.0
  vocalEQ: {
    lowCutFreq: number;
    lowMidFreq: number;
    lowMidGain: number;
    highMidFreq: number;
    highMidGain: number;
    highBoostFreq: number;
    highBoostGain: number;
  };
  vocalCompressor: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
  };
  masterCompressor: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
  };
}

export const defaultMixSettings: MixSettings = {
  vocalVolume: 1.0,
  beatVolume: 0.8,
  backupVolume: 0.6,
  reverb: 0.3,
  echo: 0.1,
  saturation: 0.0,
  doubler: 0.0,
  pitchCorrection: 0.0,
  vocalEQ: {
    lowCutFreq: 120,
    lowMidFreq: 400,
    lowMidGain: -2,
    highMidFreq: 2500,
    highMidGain: 2,
    highBoostFreq: 5000,
    highBoostGain: 3
  },
  vocalCompressor: {
    threshold: -24,
    ratio: 4,
    attack: 0.005,
    release: 0.1
  },
  masterCompressor: {
    threshold: -10,
    ratio: 2,
    attack: 0.01,
    release: 0.1
  }
};

// Singleton AudioContext for decoding to ensure consistent sample rates
let decodingCtx: AudioContext | null = null;

function getDecodingCtx() {
  if (!decodingCtx) {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    try {
      decodingCtx = new AudioContextClass();
    } catch (e) {
      console.error("Failed to create AudioContext:", e);
      // If the 0-argument constructor fails, we try to catch it, 
      // but we must avoid passing an options object to webkitAudioContext
      if (AudioContextClass === (window as any).AudioContext) {
        try {
          decodingCtx = new AudioContextClass({ sampleRate: 44100 });
        } catch (e2) {
          throw e; // Throw original error if fallback also fails
        }
      } else {
        throw e;
      }
    }
  }
  return decodingCtx;
}

function makeDistortionCurve(amount: number) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function createReverb(context: BaseAudioContext, duration: number, decay: number) {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = context.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const noiseL = Math.random() * 2 - 1;
    const noiseR = Math.random() * 2 - 1;
    left[i] = noiseL * Math.pow(1 - i / length, decay);
    right[i] = noiseR * Math.pow(1 - i / length, decay);
  }
  return impulse;
}

function encodeWAV(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = channels.length;
  const length = channels[0].length;
  const buffer = new ArrayBuffer(44 + length * numChannels * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * numChannels * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * numChannels * 2, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = Math.max(-1, Math.min(1, channels[channel][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return buffer;
}

async function extractAudioData(blob: Blob) {
  const audioCtx = getDecodingCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    // decodeAudioData resamples the audio to the context's sampleRate automatically
    const buffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channels = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }
    return {
      channels,
      length: buffer.length,
      sampleRate: buffer.sampleRate
    };
  } catch (err) {
    console.error("Failed to decode audio data", err);
    throw err;
  }
}

export async function processBeat(beatBlob: Blob, speed: number, pitch: number): Promise<Blob> {
  if (speed === 1 && pitch === 0) return beatBlob;
  
  const beatData = await extractAudioData(beatBlob);
  const OfflineContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  
  const length = Math.floor(beatData.length / speed);
  const offlineCtx = new OfflineContext(beatData.channels.length, length, beatData.sampleRate);
  
  const buf = offlineCtx.createBuffer(beatData.channels.length, beatData.length, offlineCtx.sampleRate);
  for (let i = 0; i < beatData.channels.length; i++) {
    buf.copyToChannel(beatData.channels[i], i);
  }
  
  const source = offlineCtx.createBufferSource();
  source.buffer = buf;
  source.playbackRate.value = speed;
  source.detune.value = pitch * 100;
  
  source.connect(offlineCtx.destination);
  source.start(0);
  
  const renderedBuffer = await offlineCtx.startRendering();
  const outChannels = [];
  for (let i = 0; i < renderedBuffer.numberOfChannels; i++) {
    outChannels.push(renderedBuffer.getChannelData(i));
  }
  
  const wavBuffer = encodeWAV(outChannels, renderedBuffer.sampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

export async function mixAudio(
  vocalBlob: Blob,
  beatBlob: Blob,
  backupVocalBlob: Blob | null,
  settings: MixSettings
): Promise<Blob> {
  const vocalData = await extractAudioData(vocalBlob);
  const beatData = await extractAudioData(beatBlob);
  const backupData = backupVocalBlob ? await extractAudioData(backupVocalBlob) : null;
  
  const OfflineContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const sampleRate = beatData.sampleRate;
  const duration = Math.ceil(Math.max(vocalData.length, beatData.length, backupData ? backupData.length : 0));
  
  const offlineCtx = new OfflineContext(2, duration, sampleRate);

  const createBufferSource = (data: any) => {
    const buf = offlineCtx.createBuffer(data.channels.length, data.length, offlineCtx.sampleRate);
    for (let i = 0; i < data.channels.length; i++) {
      buf.copyToChannel(data.channels[i], i);
    }
    const source = offlineCtx.createBufferSource();
    source.buffer = buf;
    return source;
  };

  const vocalSource = createBufferSource(vocalData);
  const beatSource = createBufferSource(beatData);
  const backupSource = backupData ? createBufferSource(backupData) : null;

  // Vocal Chain
  const vocalGain = offlineCtx.createGain();
  vocalGain.gain.value = settings.vocalVolume;
  
  const lowCut = offlineCtx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = settings.vocalEQ.lowCutFreq;
  
  const lowMid = offlineCtx.createBiquadFilter();
  lowMid.type = 'peaking';
  lowMid.frequency.value = settings.vocalEQ.lowMidFreq;
  lowMid.gain.value = settings.vocalEQ.lowMidGain;
  lowMid.Q.value = 1.0;

  const highMid = offlineCtx.createBiquadFilter();
  highMid.type = 'peaking';
  highMid.frequency.value = settings.vocalEQ.highMidFreq;
  highMid.gain.value = settings.vocalEQ.highMidGain;
  highMid.Q.value = 1.0;

  const highBoost = offlineCtx.createBiquadFilter();
  highBoost.type = 'highshelf';
  highBoost.frequency.value = settings.vocalEQ.highBoostFreq;
  highBoost.gain.value = settings.vocalEQ.highBoostGain;
  
  const saturation = offlineCtx.createWaveShaper();
  saturation.curve = makeDistortionCurve(settings.saturation * 100);
  saturation.oversample = '4x';

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = settings.vocalCompressor.threshold;
  compressor.knee.value = 30;
  compressor.ratio.value = settings.vocalCompressor.ratio;
  compressor.attack.value = settings.vocalCompressor.attack;
  compressor.release.value = settings.vocalCompressor.release;
  
  // Abbey Road Reverb Trick
  const convolver = offlineCtx.createConvolver();
  convolver.buffer = createReverb(offlineCtx, 2.5, 2.0);
  
  const reverbHpf = offlineCtx.createBiquadFilter();
  reverbHpf.type = 'highpass';
  reverbHpf.frequency.value = 600;
  
  const reverbLpf = offlineCtx.createBiquadFilter();
  reverbLpf.type = 'lowpass';
  reverbLpf.frequency.value = 4000;
  
  const reverbGain = offlineCtx.createGain();
  reverbGain.gain.value = settings.reverb;
  
  const delay = offlineCtx.createDelay();
  delay.delayTime.value = 0.4;
  const feedback = offlineCtx.createGain();
  feedback.gain.value = 0.3;
  delay.connect(feedback);
  feedback.connect(delay);
  const delayGain = offlineCtx.createGain();
  delayGain.gain.value = settings.echo;
  
  // Doubler / Widener
  const leftDelay = offlineCtx.createDelay();
  leftDelay.delayTime.value = 0.015; // 15ms
  const rightDelay = offlineCtx.createDelay();
  rightDelay.delayTime.value = 0.025; // 25ms
  
  const leftPanner = offlineCtx.createStereoPanner();
  leftPanner.pan.value = -0.8;
  const rightPanner = offlineCtx.createStereoPanner();
  rightPanner.pan.value = 0.8;
  
  const doublerGain = offlineCtx.createGain();
  doublerGain.gain.value = settings.doubler;
  
  // Routing Vocal
  vocalSource.connect(lowCut);
  lowCut.connect(lowMid);
  lowMid.connect(highMid);
  highMid.connect(highBoost);
  highBoost.connect(saturation);
  saturation.connect(compressor);
  compressor.connect(vocalGain);
  
  // Route to Doubler
  compressor.connect(leftDelay);
  leftDelay.connect(leftPanner);
  leftPanner.connect(doublerGain);
  
  compressor.connect(rightDelay);
  rightDelay.connect(rightPanner);
  rightPanner.connect(doublerGain);
  
  compressor.connect(convolver);
  convolver.connect(reverbHpf);
  reverbHpf.connect(reverbLpf);
  reverbLpf.connect(reverbGain);
  
  compressor.connect(delay);
  delay.connect(delayGain);
  
  // Beat Chain
  const beatGain = offlineCtx.createGain();
  beatGain.gain.value = settings.beatVolume;
  beatSource.connect(beatGain);
  
  // Master Chain
  const masterCompressor = offlineCtx.createDynamicsCompressor();
  masterCompressor.threshold.value = settings.masterCompressor.threshold;
  masterCompressor.ratio.value = settings.masterCompressor.ratio;
  masterCompressor.attack.value = settings.masterCompressor.attack;
  masterCompressor.release.value = settings.masterCompressor.release;
  
  // Cross-Device Optimization: Master Brickwall Limiter
  // Ensures audio never clips and maximizes perceived loudness for mobile/tablet speakers
  const masterLimiter = offlineCtx.createDynamicsCompressor();
  masterLimiter.threshold.value = -0.1; // Just below 0dBFS
  masterLimiter.ratio.value = 20.0; // Brickwall
  masterLimiter.attack.value = 0.001; // Instant attack
  masterLimiter.release.value = 0.05; // Fast release
  
  if (backupSource) {
    const backupGain = offlineCtx.createGain();
    backupGain.gain.value = settings.backupVolume;
    backupSource.connect(backupGain);
    backupGain.connect(masterCompressor);
    backupGain.connect(convolver);
    backupSource.start(0);
  }
  
  vocalGain.connect(masterCompressor);
  doublerGain.connect(masterCompressor);
  reverbGain.connect(masterCompressor);
  delayGain.connect(masterCompressor);
  beatGain.connect(masterCompressor);
  
  masterCompressor.connect(masterLimiter);
  masterLimiter.connect(offlineCtx.destination);
  
  vocalSource.start(0);
  
  // Basic Pitch Correction (simulated via detune if we had pitch data, 
  // but here we'll just add it as a placeholder for the UI and AI to use)
  // Real autotune requires complex DSP, but we can use detune for simple shifts.
  
  beatSource.start(0);
  
  const renderedBuffer = await offlineCtx.startRendering();
  
  // Cross-Device Optimization: Normalization
  // Maximize volume to 0.95 (-0.4 dBFS) to ensure it sounds loud and clear on all devices
  const outChannels = [renderedBuffer.getChannelData(0), renderedBuffer.getChannelData(1)];
  
  let maxPeak = 0;
  for (let c = 0; c < outChannels.length; c++) {
    const channel = outChannels[c];
    for (let i = 0; i < channel.length; i++) {
      const absVal = Math.abs(channel[i]);
      if (absVal > maxPeak) maxPeak = absVal;
    }
  }
  
  if (maxPeak > 0) {
    const normalizeFactor = 0.95 / maxPeak;
    for (let c = 0; c < outChannels.length; c++) {
      const channel = outChannels[c];
      for (let i = 0; i < channel.length; i++) {
        channel[i] *= normalizeFactor;
      }
    }
  }

  const wavBuffer = encodeWAV(outChannels, renderedBuffer.sampleRate);
  
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

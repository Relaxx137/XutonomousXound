// ═══════════════════════════════════════════════════════════════════════════════
// XutonomousXound — AI Agent Network for Intelligent Mix Engineering
// ═══════════════════════════════════════════════════════════════════════════════
// Multi-agent system using Gemini AI with data-driven audio analysis to
// produce professional mixing and mastering decisions.
// ═══════════════════════════════════════════════════════════════════════════════

import { GoogleGenAI } from '@google/genai';
import {
  MixSettings,
  mixAudio,
  defaultMixSettings,
  analyzeAudio,
  FullAudioAnalysis,
  GenrePreset,
  applyGenrePreset,
} from './audioUtils';

export interface AILog {
  agent: string;
  message: string;
  details?: string;
}

async function blobToGenerativePart(blob: Blob) {
  return new Promise<{ inlineData: { data: string; mimeType: string } }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve({
          inlineData: {
            data: base64,
            mimeType: blob.type || 'audio/webm'
          }
        });
      } else {
        reject(new Error("Failed to read blob as base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Decode a Blob to an AudioBuffer for analysis.
 */
async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error("AudioContext not supported");
  const ctx = new AudioContextClass();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();
  return buffer;
}

/**
 * Format an audio analysis into a concise but data-rich string for AI consumption.
 */
function formatAnalysis(label: string, analysis: FullAudioAnalysis): string {
  const s = analysis.spectral;
  const l = analysis.loudness;
  const sib = analysis.sibilance;
  const st = analysis.stereo;

  return `
═══ ${label} Audio Analysis ═══
▸ Spectral Balance:
  Sub-Bass (20-60Hz): ${s.subBass.toFixed(1)} dB
  Bass (60-250Hz): ${s.bass.toFixed(1)} dB
  Low-Mid (250-500Hz): ${s.lowMid.toFixed(1)} dB
  Mid (500-2kHz): ${s.mid.toFixed(1)} dB
  Upper-Mid (2-4kHz): ${s.upperMid.toFixed(1)} dB
  Presence (4-6kHz): ${s.presence.toFixed(1)} dB
  Brilliance (6-20kHz): ${s.brilliance.toFixed(1)} dB
  Dominant Frequency: ${s.dominantFrequency.toFixed(0)} Hz

▸ Loudness:
  Peak: ${l.peakDB.toFixed(1)} dBFS
  RMS: ${l.rmsDB.toFixed(1)} dBFS
  Est. LUFS: ${l.estimatedLUFS.toFixed(1)} LUFS
  Crest Factor: ${l.crestFactor.toFixed(1)} dB

▸ Sibilance: ${sib.hasSibilance ? `DETECTED (severity: ${(sib.severity * 100).toFixed(0)}%, peak: ${sib.peakFrequency}Hz)` : 'Not significant'}

▸ Stereo:
  Correlation: ${st.correlation.toFixed(2)} ${st.correlation > 0.9 ? '(mostly mono)' : st.correlation > 0.5 ? '(normal stereo)' : '(wide stereo)'}
  Width: ${(st.width * 100).toFixed(0)}%
  Balance: ${st.balance.toFixed(2)} ${Math.abs(st.balance) < 0.05 ? '(centered)' : st.balance > 0 ? '(right heavy)' : '(left heavy)'}

▸ Dynamic Range: ${analysis.dynamicRange.toFixed(1)} dB
`.trim();
}

// ─── Structured Output Schemas ───────────────────────────────────────────────

const mixSettingsSchemaProperties = {
  genrePreset: { type: "STRING", description: "Genre preset: 'hip-hop', 'pop', 'electronic', 'acoustic', or 'custom'" },
  vocalVolume: { type: "NUMBER", description: "0.0 to 2.0" },
  beatVolume: { type: "NUMBER", description: "0.0 to 2.0" },
  backupVolume: { type: "NUMBER", description: "0.0 to 2.0" },

  // Vocal EQ
  vocalEQ: {
    type: "OBJECT",
    properties: {
      lowCutFreq: { type: "NUMBER", description: "High-pass filter frequency (60-200 Hz)" },
      lowMidFreq: { type: "NUMBER", description: "Subtractive EQ center (200-800 Hz)" },
      lowMidGain: { type: "NUMBER", description: "Subtractive cut (-8 to +4 dB, negative to cut mud)" },
      lowMidQ: { type: "NUMBER", description: "Q/bandwidth (0.5-4.0)" },
      highMidFreq: { type: "NUMBER", description: "High-mid EQ center (1000-6000 Hz)" },
      highMidGain: { type: "NUMBER", description: "Boost/cut (-6 to +6 dB)" },
      highMidQ: { type: "NUMBER", description: "Q/bandwidth (0.5-4.0)" },
      presenceFreq: { type: "NUMBER", description: "Presence band (3000-6000 Hz)" },
      presenceGain: { type: "NUMBER", description: "Boost for vocal clarity (-4 to +6 dB)" },
      presenceQ: { type: "NUMBER", description: "Q/bandwidth (0.5-3.0)" },
      airFreq: { type: "NUMBER", description: "Air shelf frequency (8000-16000 Hz)" },
      airGain: { type: "NUMBER", description: "Air boost (0 to +6 dB)" },
    }
  },

  // De-Esser
  deEsser: {
    type: "OBJECT",
    properties: {
      frequency: { type: "NUMBER", description: "De-esser center frequency (4000-10000 Hz)" },
      threshold: { type: "NUMBER", description: "De-esser threshold (-40 to -10 dB)" },
      ratio: { type: "NUMBER", description: "De-esser ratio (2-10)" },
      enabled: { type: "BOOLEAN", description: "Enable de-essing" },
    }
  },

  // Vocal Compressor
  vocalCompressor: {
    type: "OBJECT",
    properties: {
      threshold: { type: "NUMBER", description: "-40 to -10 dB" },
      ratio: { type: "NUMBER", description: "2 to 8" },
      attack: { type: "NUMBER", description: "0.001 to 0.05 seconds" },
      release: { type: "NUMBER", description: "0.05 to 0.3 seconds" },
      knee: { type: "NUMBER", description: "0 to 30 dB" },
    }
  },

  // Parallel Compression
  parallelCompression: {
    type: "OBJECT",
    properties: {
      enabled: { type: "BOOLEAN", description: "Enable parallel/NY compression" },
      wetDry: { type: "NUMBER", description: "Blend amount 0.0-1.0" },
      threshold: { type: "NUMBER", description: "-40 to -20 dB" },
      ratio: { type: "NUMBER", description: "8 to 20" },
    }
  },

  // Saturation
  saturation: { type: "NUMBER", description: "Tape saturation amount 0.0-1.0" },
  saturationDrive: { type: "NUMBER", description: "Drive intensity 0.0-1.0" },

  // Spatial
  reverb: { type: "NUMBER", description: "Reverb send level 0.0-1.0" },
  reverbPreDelay: { type: "NUMBER", description: "Pre-delay ms 0-80" },
  reverbDecay: { type: "NUMBER", description: "Decay time 0.5-5.0 seconds" },
  reverbDamping: { type: "NUMBER", description: "HF damping 0.0-1.0" },
  echo: { type: "NUMBER", description: "Delay send level 0.0-1.0" },
  echoTime: { type: "NUMBER", description: "Delay time 0.1-1.0 seconds" },
  echoFeedback: { type: "NUMBER", description: "Delay feedback 0.0-0.7" },
  doubler: { type: "NUMBER", description: "Vocal doubler/widener 0.0-1.0" },

  // Beat Chain
  beatEQ: {
    type: "OBJECT",
    properties: {
      lowFreq: { type: "NUMBER", description: "Bass shelf freq 60-200 Hz" },
      lowGain: { type: "NUMBER", description: "-6 to +6 dB" },
      lowMidFreq: { type: "NUMBER", description: "Low-mid freq 200-800 Hz" },
      lowMidGain: { type: "NUMBER", description: "-6 to +6 dB" },
      highMidFreq: { type: "NUMBER", description: "High-mid freq 800-4000 Hz" },
      highMidGain: { type: "NUMBER", description: "-6 to +6 dB, cut here to make room for vocals" },
      highFreq: { type: "NUMBER", description: "High shelf freq 4000-12000 Hz" },
      highGain: { type: "NUMBER", description: "-6 to +6 dB" },
    }
  },
  beatCompressor: {
    type: "OBJECT",
    properties: {
      threshold: { type: "NUMBER", description: "-30 to -6 dB" },
      ratio: { type: "NUMBER", description: "1.5 to 6" },
      attack: { type: "NUMBER", description: "0.003 to 0.05 s" },
      release: { type: "NUMBER", description: "0.05 to 0.3 s" },
    }
  },
  sidechainDuck: { type: "NUMBER", description: "Beat sidechain ducking amount 0.0-1.0 (subtle: 0.1-0.25)" },

  // Mastering
  stereoImaging: {
    type: "OBJECT",
    properties: {
      width: { type: "NUMBER", description: "Stereo width 0.5-2.0 (1.0 = normal)" },
      bassMonoCutoff: { type: "NUMBER", description: "Bass mono frequency cutoff 0-300 Hz" },
    }
  },
  masterMultiband: {
    type: "OBJECT",
    properties: {
      low: {
        type: "OBJECT",
        properties: {
          threshold: { type: "NUMBER", description: "-24 to -6 dB" },
          ratio: { type: "NUMBER", description: "1.5 to 4" },
          attack: { type: "NUMBER", description: "0.01 to 0.05 s" },
          release: { type: "NUMBER", description: "0.1 to 0.4 s" },
        }
      },
      mid: {
        type: "OBJECT",
        properties: {
          threshold: { type: "NUMBER", description: "-20 to -6 dB" },
          ratio: { type: "NUMBER", description: "1.5 to 4" },
          attack: { type: "NUMBER", description: "0.005 to 0.03 s" },
          release: { type: "NUMBER", description: "0.08 to 0.3 s" },
        }
      },
      high: {
        type: "OBJECT",
        properties: {
          threshold: { type: "NUMBER", description: "-24 to -6 dB" },
          ratio: { type: "NUMBER", description: "1.5 to 4" },
          attack: { type: "NUMBER", description: "0.003 to 0.02 s" },
          release: { type: "NUMBER", description: "0.05 to 0.2 s" },
        }
      },
    }
  },
  masterEQ: {
    type: "OBJECT",
    properties: {
      lowShelfFreq: { type: "NUMBER", description: "60-200 Hz" },
      lowShelfGain: { type: "NUMBER", description: "-4 to +4 dB" },
      midFreq: { type: "NUMBER", description: "500-4000 Hz" },
      midGain: { type: "NUMBER", description: "-4 to +4 dB" },
      midQ: { type: "NUMBER", description: "0.5-4.0" },
      highShelfFreq: { type: "NUMBER", description: "6000-16000 Hz" },
      highShelfGain: { type: "NUMBER", description: "-4 to +4 dB" },
    }
  },
  masterLimiter: {
    type: "OBJECT",
    properties: {
      ceiling: { type: "NUMBER", description: "True peak ceiling -3.0 to 0 dB" },
      release: { type: "NUMBER", description: "0.01 to 0.5 s" },
    }
  },
  masterGain: { type: "NUMBER", description: "Pre-limiter gain 0.5-2.0" },
  softClipAmount: { type: "NUMBER", description: "Soft clipping 0.0-1.0" },
  lufsTarget: { type: "NUMBER", description: "Target loudness -14 to -6 LUFS" },
};

const detailedReasoningSchema = {
  type: "OBJECT",
  properties: {
    eqReasoning: { type: "STRING", description: "Why specific frequencies were cut/boosted for both vocal and beat" },
    compressionReasoning: { type: "STRING", description: "Reasoning for compressor settings including multiband and parallel compression decisions" },
    deEsserReasoning: { type: "STRING", description: "Whether de-essing was needed based on sibilance analysis" },
    spatialReasoning: { type: "STRING", description: "Reverb, delay, doubler, and stereo imaging decisions" },
    masteringReasoning: { type: "STRING", description: "Mastering chain decisions: multiband compression, EQ, limiter, LUFS target" },
    overallBalance: { type: "STRING", description: "Volume balance and genre-specific considerations" },
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runAIAgentNetwork(
  vocalBlob: Blob,
  beatBlob: Blob,
  backupVocalBlob: Blob | null,
  iterations: number,
  onProgress: (log: AILog) => void
): Promise<{ settings: MixSettings, reasoning: string }> {

  const apiKey = process.env.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
  if (!apiKey) {
    throw new Error("API Key is missing. Add your Gemini API key in Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-2.0-flash';

  try {
    let currentSettings: any = null;
    let analysisText = "";
    const vocalPart = await blobToGenerativePart(vocalBlob);
    const beatPart = await blobToGenerativePart(beatBlob);

    const contents: any[] = [];
    let promptAddon = "Track 1 is the raw main vocal recording. Track 2 is the instrumental beat.";

    if (backupVocalBlob) {
      const backupPart = await blobToGenerativePart(backupVocalBlob);
      contents.push(vocalPart, beatPart, backupPart);
      promptAddon += " Track 3 is the backup vocal recording.";
    } else {
      contents.push(vocalPart, beatPart);
    }

    // ═══════════════════════════════════════════════════════════════
    // PRE-ANALYSIS: Data-Driven Audio Measurements
    // ═══════════════════════════════════════════════════════════════

    onProgress({
      agent: 'Acoustic Analyst',
      message: 'Running spectral analysis, loudness measurement, and sibilance detection on all tracks...',
    });

    const vocalBuffer = await decodeBlob(vocalBlob);
    const beatBuffer = await decodeBlob(beatBlob);

    const vocalAnalysis = analyzeAudio(vocalBuffer);
    const beatAnalysis = analyzeAudio(beatBuffer);

    const vocalAnalysisStr = formatAnalysis('VOCAL', vocalAnalysis);
    const beatAnalysisStr = formatAnalysis('BEAT', beatAnalysis);

    let backupAnalysisStr = "";
    if (backupVocalBlob) {
      const backupBuffer = await decodeBlob(backupVocalBlob);
      const backupAnalysis = analyzeAudio(backupBuffer);
      backupAnalysisStr = formatAnalysis('BACKUP VOCAL', backupAnalysis);
    }

    onProgress({
      agent: 'Acoustic Analyst',
      message: 'Audio measurements complete. Key findings:',
      details: [
        `Vocal: ${vocalAnalysis.loudness.rmsDB.toFixed(1)} dBFS RMS, ${vocalAnalysis.sibilance.hasSibilance ? '⚠️ sibilance detected' : '✅ no sibilance'}`,
        `Beat: ${beatAnalysis.loudness.rmsDB.toFixed(1)} dBFS RMS, stereo width ${(beatAnalysis.stereo.width * 100).toFixed(0)}%`,
        `Dynamic range: vocal ${vocalAnalysis.dynamicRange.toFixed(1)}dB, beat ${beatAnalysis.dynamicRange.toFixed(1)}dB`,
      ].join('\n'),
    });

    for (let i = 1; i <= iterations; i++) {
      if (i === 1) {
        // ═══════════════════════════════════════════════════════════════
        // AGENT 1: Acoustic Analyst + AI Listening
        // ═══════════════════════════════════════════════════════════════
        onProgress({
          agent: 'Acoustic Analyst',
          message: 'Combining AI listening with numerical analysis for comprehensive assessment...'
        });

        const analysisPrompt = `You are an expert acoustic analyst and mix engineer. Listen to these audio tracks and analyze them in combination with the numerical measurements provided.

${promptAddon}

═══ NUMERICAL AUDIO MEASUREMENTS ═══

${vocalAnalysisStr}

${beatAnalysisStr}

${backupAnalysisStr ? backupAnalysisStr : ''}

═══ YOUR TASK ═══
Based on BOTH your listening AND the measurements above:
1. Identify frequency clashes between vocal and beat (especially in the 200-500Hz and 2-5kHz ranges)
2. Assess whether the vocal needs de-essing (check the sibilance analysis)
3. Determine the genre and energy level to select the right preset approach
4. Identify dynamic range issues (is the vocal too dynamic? too compressed already?)
5. Assess stereo balance (is the beat mono? does it need widening? is bass centered?)
6. Note the loudness differential between vocal and beat to set volume balance

Provide a detailed acoustic assessment with specific frequency recommendations.`;

        const analysisResponse = await ai.models.generateContent({
          model,
          contents: [analysisPrompt, ...contents]
        });

        analysisText = analysisResponse.text || "Analysis completed.";
        onProgress({
          agent: 'Acoustic Analyst',
          message: 'Comprehensive acoustic analysis complete.',
          details: analysisText
        });

        await delay(2500);

        // ═══════════════════════════════════════════════════════════════
        // AGENT 2: Mix Engineer (Data-Driven Initial Draft)
        // ═══════════════════════════════════════════════════════════════
        onProgress({
          agent: 'Mix Engineer',
          message: 'Drafting mix strategy using acoustic analysis and measurements...'
        });

        const mixSchema = {
          type: "OBJECT",
          properties: {
            settings: {
              type: "OBJECT",
              properties: mixSettingsSchemaProperties
            },
            reasoning: detailedReasoningSchema
          }
        };

        const mixPrompt = `You are a professional Mix Engineer creating settings for an automated mixing engine. You must produce optimal settings based on the acoustic analysis and measurements.

═══ ACOUSTIC ANALYSIS ═══
${analysisText}

═══ NUMERICAL MEASUREMENTS ═══
${vocalAnalysisStr}
${beatAnalysisStr}

═══ YOUR DECISIONS ═══

You are configuring a PROFESSIONAL mixing and mastering chain with these stages:

VOCAL CHAIN:
- High-pass filter (lowCutFreq): Set based on the vocal's sub-bass content. Typical: 80-120Hz.
- Subtractive EQ (lowMidFreq/lowMidGain): CUT problematic frequencies (mud at 200-500Hz). Always cut FIRST.
- De-Esser (frequency/threshold/ratio): Enable if sibilance was detected. Target the peak sibilance frequency.
- Compressor (threshold/ratio/attack/release/knee): 1176-style for vocal control.
- Parallel compression (enabled/wetDry/threshold/ratio): Blend in heavily compressed signal for body.
- Presence EQ (presenceFreq/presenceGain): Boost vocal clarity at 3-5kHz.
- Air EQ (airFreq/airGain): High shelf for sparkle and air, typically 10-14kHz.
- Saturation/drive: Tape warmth. Use subtly (0.1-0.3) unless the genre calls for more.
- Reverb (send level, predelay, decay, damping): Match the energy. Hip-hop = short/tight, pop = medium, acoustic = long.
- Delay/Echo: Rhythmic enhancement.
- Doubler: For width and fullness.

BEAT CHAIN:
- Beat EQ: CUT the high-mid range where the vocal sits (2-4kHz) to create SPACE for the vocal.
- Beat compressor: Control dynamics.
- Sidechain duck: Subtle ducking (0.1-0.25) when vocal is present.

MASTERING CHAIN:
- Stereo imaging (width, bassMonoCutoff): Widen for impact, mono below 100-150Hz.
- Master multiband compressor: Tighten low end, control mids, smooth highs.
- Master EQ: Sweetening. Very subtle moves (±2dB max).
- Soft clipper: Shave transient peaks before limiter (0.1-0.3).
- Limiter ceiling: -1.0 dBTP for streaming safety.
- LUFS target: ${vocalAnalysis.loudness.estimatedLUFS < -18 ? '-10 (needs significant gain)' : '-9 (standard competitive loudness)'}

CRITICAL RULES:
- If sibilance was detected, ENABLE the de-esser and set frequency to the detected peak.
- Beat high-mid gain should be NEGATIVE to carve space for vocals.
- Reverb pre-delay should be 15-30ms to keep vocal upfront.
- Parallel compression wetDry should be 0.15-0.35 (subtle blend).
- Bass mono cutoff should be 100-180Hz for tight low end.
- Keep all moves MUSICAL. Less is more in mastering.

Output JSON only.`;

        const mixResponse = await ai.models.generateContent({
          model,
          contents: mixPrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: mixSchema as any,
          }
        });

        const draftMix = JSON.parse(mixResponse.text || "{}");
        currentSettings = draftMix.settings;

        onProgress({
          agent: 'Mix Engineer',
          message: 'Initial mix strategy complete.',
          details: [
            `EQ: ${draftMix.reasoning?.eqReasoning || 'Applied'}`,
            `Compression: ${draftMix.reasoning?.compressionReasoning || 'Applied'}`,
            `De-Esser: ${draftMix.reasoning?.deEsserReasoning || 'Checked'}`,
            `Spatial: ${draftMix.reasoning?.spatialReasoning || 'Configured'}`,
          ].join('\n')
        });

        await delay(2500);

      } else {
        // ═══════════════════════════════════════════════════════════════
        // AGENT 4: Review Engineer (Iterative Refinement)
        // ═══════════════════════════════════════════════════════════════
        onProgress({
          agent: `Review Engineer (Pass ${i})`,
          message: `Rendering current mix to analyze and refine...`
        });

        // Render the current mix with current settings
        const fullSettings: MixSettings = deepMergeSettings(defaultMixSettings, currentSettings);
        const currentMixBlob = await mixAudio(vocalBlob, beatBlob, backupVocalBlob, fullSettings);
        const currentMixPart = await blobToGenerativePart(currentMixBlob);

        // Analyze the rendered mix
        const mixBuffer = await decodeBlob(currentMixBlob);
        const mixAnalysis = analyzeAudio(mixBuffer);
        const mixAnalysisStr = formatAnalysis('CURRENT MIX', mixAnalysis);

        onProgress({
          agent: `Review Engineer (Pass ${i})`,
          message: `Listening to rendered mix and analyzing results...`,
          details: `Mix loudness: ${mixAnalysis.loudness.estimatedLUFS.toFixed(1)} LUFS, stereo width: ${(mixAnalysis.stereo.width * 100).toFixed(0)}%`
        });

        const reviewSchema = {
          type: "OBJECT",
          properties: {
            settings: {
              type: "OBJECT",
              properties: mixSettingsSchemaProperties
            },
            reasoning: detailedReasoningSchema,
            critique: { type: "STRING", description: "Specific critique of the current mix and what was changed." }
          }
        };

        const reviewPrompt = `You are a Senior Mix Engineer reviewing a rendered mix. Listen to the audio and compare it with the numerical measurements.

═══ CURRENT MIX MEASUREMENTS ═══
${mixAnalysisStr}

═══ ORIGINAL TRACK MEASUREMENTS ═══
${vocalAnalysisStr}
${beatAnalysisStr}

═══ CURRENT SETTINGS ═══
${JSON.stringify(currentSettings, null, 2)}

═══ YOUR TASK ═══
Critique this mix based on BOTH your listening AND the measurements:

1. Vocal presence: Is the vocal clear and upfront, or buried? Check mid/presence energy.
2. Frequency balance: Compare the mix's spectral balance to professional standards.
3. Dynamic control: Is the crest factor appropriate? (Typically 6-10dB for mastered music)
4. Stereo field: Is the width appropriate? Is the bass properly centered?
5. Loudness: Is the estimated LUFS close to the target? Adjust masterGain if needed.
6. De-essing: Is sibilance controlled?
7. Spatial effects: Are reverb/delay appropriate? Too much = washy, too little = dry.

Provide UPDATED settings to fix any remaining issues. Be specific about what you changed and why.
Output JSON only.`;

        const reviewResponse = await ai.models.generateContent({
          model,
          contents: [reviewPrompt, currentMixPart],
          config: {
            responseMimeType: "application/json",
            responseSchema: reviewSchema as any,
          }
        });

        const updatedMix = JSON.parse(reviewResponse.text || "{}");
        currentSettings = updatedMix.settings;

        onProgress({
          agent: `Review Engineer (Pass ${i})`,
          message: `Mix refinement complete.`,
          details: `Critique: ${updatedMix.critique}\nMastering: ${updatedMix.reasoning?.masteringReasoning || 'Adjusted'}`
        });

        await delay(3000);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // AGENT 3: Mastering Engineer (Final Polish)
    // ═══════════════════════════════════════════════════════════════
    onProgress({
      agent: 'Mastering Engineer',
      message: 'Applying final mastering checks with loudness and spectral analysis...'
    });

    const masterSchema = {
      type: "OBJECT",
      properties: {
        settings: {
          type: "OBJECT",
          properties: mixSettingsSchemaProperties
        },
        masteringNotes: { type: "STRING", description: "Detailed mastering notes covering EQ, dynamics, stereo, and loudness decisions." }
      }
    };

    const masterPrompt = `You are a Grammy-winning Mastering Engineer applying final polish to a mix. You have access to the full signal chain.

═══ ACOUSTIC ANALYSIS ═══
${analysisText}

═══ NUMERICAL MEASUREMENTS ═══
Vocal: RMS ${vocalAnalysis.loudness.rmsDB.toFixed(1)} dBFS, Peak ${vocalAnalysis.loudness.peakDB.toFixed(1)} dBFS
Beat: RMS ${beatAnalysis.loudness.rmsDB.toFixed(1)} dBFS, Peak ${beatAnalysis.loudness.peakDB.toFixed(1)} dBFS

═══ MIX ENGINEER'S SETTINGS ═══
${JSON.stringify(currentSettings, null, 2)}

═══ YOUR MASTERING DECISIONS ═══

As the mastering engineer, focus on these final elements:

1. MASTER MULTIBAND COMPRESSION:
   - Low band (<250Hz): Tighten the bass. Slower attack, moderate ratio.
   - Mid band (250-4kHz): Glue the vocal and beat. Moderate attack and ratio.
   - High band (>4kHz): Smooth harshness. Moderate settings.

2. MASTER EQ (Sweetening):
   - Very subtle moves only (±2dB). This is mastering — surgical precision.
   - Low shelf: Warmth or clarity.
   - High shelf: Air and sparkle.

3. STEREO IMAGING:
   - Width: 1.0-1.3 (don't over-widen).
   - Bass mono cutoff: 100-180Hz (tight, punchy bass).

4. SOFT CLIPPER: Shave 1-3dB of transient peaks before the limiter (0.1-0.3).

5. LIMITER:
   - Ceiling: -1.0 dBTP (streaming safe).
   - Release: Fast enough to be transparent (0.03-0.08s).

6. LUFS TARGET: Choose genre-appropriate loudness.
   - Hip-hop/Pop: -8 to -10 LUFS
   - Electronic: -7 to -9 LUFS
   - Acoustic: -11 to -14 LUFS

7. MASTER GAIN: Adjust to drive the limiter appropriately.

CRITICAL: Do NOT over-process. Mastering is about polish, not surgery.
The mix engineer has already done most of the heavy lifting.
Your job is to ensure commercial-ready loudness, tonal balance, and stereo coherence.

Output JSON only.`;

    const masterResponse = await ai.models.generateContent({
      model,
      contents: masterPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: masterSchema as any,
      }
    });

    const finalResult = JSON.parse(masterResponse.text || "{}");
    onProgress({
      agent: 'Mastering Engineer',
      message: 'Mastering and final approval complete.',
      details: finalResult.masteringNotes
    });

    // Merge the AI settings with defaults to ensure all fields are populated
    const finalSettings = deepMergeSettings(defaultMixSettings, finalResult.settings);

    return {
      settings: finalSettings,
      reasoning: finalResult.masteringNotes
    };

  } catch (error: any) {
    console.error("AI Agent Network Error:", error);

    const errorMessage = error?.message || '';
    if (error?.status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      throw new Error("API Quota Exceeded (429). The Gemini API rate limit was reached. Please try reducing the 'AI Iterations' slider to 1, or wait a minute before trying again. If you are on a free tier, you may have exhausted your daily quota.");
    }

    throw error;
  }
}

/**
 * Deep merge settings, preserving all fields from target and applying overrides from source.
 */
function deepMergeSettings(target: MixSettings, source: any): MixSettings {
  const result: any = { ...target };
  if (!source) return result;

  for (const key of Object.keys(source)) {
    if (source[key] !== null && source[key] !== undefined) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof result[key] === 'object') {
        result[key] = { ...result[key], ...source[key] };
      } else {
        result[key] = source[key];
      }
    }
  }
  return result as MixSettings;
}

import { GoogleGenAI } from '@google/genai';
import { MixSettings, mixAudio } from './audioUtils';

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

const mixSettingsSchemaProperties = {
  vocalVolume: { type: "NUMBER", description: "0.0 to 2.0" },
  beatVolume: { type: "NUMBER", description: "0.0 to 2.0" },
  backupVolume: { type: "NUMBER", description: "0.0 to 2.0" },
  reverb: { type: "NUMBER", description: "0.0 to 1.0" },
  echo: { type: "NUMBER", description: "0.0 to 1.0" },
  saturation: { type: "NUMBER", description: "0.0 to 1.0 for vocal warmth/distortion" },
  doubler: { type: "NUMBER", description: "0.0 to 1.0 for vocal widening/doubling effect" },
  pitchCorrection: { type: "NUMBER", description: "0.0 to 1.0 for vocal pitch correction intensity" },
  vocalEQ: {
    type: "OBJECT",
    properties: {
      lowCutFreq: { type: "NUMBER", description: "80 to 250 Hz" },
      lowMidFreq: { type: "NUMBER", description: "250 to 800 Hz" },
      lowMidGain: { type: "NUMBER", description: "-6 to 3 dB" },
      highMidFreq: { type: "NUMBER", description: "1000 to 4000 Hz" },
      highMidGain: { type: "NUMBER", description: "-4 to 4 dB" },
      highBoostFreq: { type: "NUMBER", description: "5000 to 10000 Hz" },
      highBoostGain: { type: "NUMBER", description: "0 to 6 dB" }
    }
  },
  vocalCompressor: {
    type: "OBJECT",
    properties: {
      threshold: { type: "NUMBER", description: "-40 to -10 dB" },
      ratio: { type: "NUMBER", description: "2 to 8" },
      attack: { type: "NUMBER", description: "0.001 to 0.05 seconds" },
      release: { type: "NUMBER", description: "0.05 to 0.3 seconds" }
    }
  }
};

const detailedReasoningSchema = {
  type: "OBJECT",
  properties: {
    eqReasoning: { type: "STRING", description: "Detailed explanation of why specific frequencies were cut or boosted." },
    compressionReasoning: { type: "STRING", description: "Detailed explanation of threshold, ratio, attack, and release choices." },
    spatialReasoning: { type: "STRING", description: "Explanation of reverb, delay, and saturation choices." },
    overallBalance: { type: "STRING", description: "Explanation of volume levels." }
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
  
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please select an API key.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3-flash-preview';

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

    for (let i = 1; i <= iterations; i++) {
      if (i === 1) {
        // --- AGENT 1: Acoustic Analyst ---
        onProgress({
          agent: 'Acoustic Analyst',
          message: 'Listening to raw audio tracks and analyzing acoustic profiles...'
        });

        const analysisPrompt = `You are an expert acoustic analyst. Listen to these audio tracks.
        ${promptAddon}
        Describe the characteristics of the tracks in detail. Focus on:
        - Frequency balance (lows, low-mids, high-mids, highs)
        - Dynamics (transients, dynamic range)
        - Genre and vibe
        - Potential clashes between the vocals and the beat (e.g., muddiness in the low-mids, harshness in the high-mids).`;

        const analysisResponse = await ai.models.generateContent({
          model,
          contents: [analysisPrompt, ...contents]
        });

        analysisText = analysisResponse.text || "Analysis completed.";
        onProgress({
          agent: 'Acoustic Analyst',
          message: 'Acoustic analysis complete.',
          details: analysisText
        });
        
        // Rate limit protection
        await delay(2500);

        // --- AGENT 2: Mix Engineer (Initial Draft) ---
        onProgress({
          agent: 'Mix Engineer',
          message: 'Drafting initial mix strategy based on acoustic analysis...'
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

        const mixPrompt = `You are a professional Mix Engineer. Based on this acoustic analysis:
        ---
        ${analysisText}
        ---
        Generate the optimal mix settings to blend the vocal and beat. Use the multi-band EQ to carve out space and add presence. Use saturation for warmth if needed. Use the 'doubler' setting to add width to the vocals if they feel too thin or centered. Output JSON.`;

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
          details: `EQ: ${draftMix.reasoning?.eqReasoning}\nComp: ${draftMix.reasoning?.compressionReasoning}`
        });
        
        // Rate limit protection
        await delay(2500);
      } else {
        // --- AGENT 4: Review Engineer (Iterative Loop) ---
        onProgress({
          agent: `Review Engineer (Pass ${i})`,
          message: `Rendering current mix to listen for adjustments...`
        });

        // Render current mix
        const { defaultMixSettings } = await import('./audioUtils');
        const fullSettings: MixSettings = { ...defaultMixSettings, ...currentSettings };
        
        const currentMixBlob = await mixAudio(vocalBlob, beatBlob, backupVocalBlob, fullSettings);
        const currentMixPart = await blobToGenerativePart(currentMixBlob);

        onProgress({
          agent: `Review Engineer (Pass ${i})`,
          message: `Listening to the rendered mix and refining settings...`
        });

        const reviewSchema = {
          type: "OBJECT",
          properties: {
            settings: {
              type: "OBJECT",
              properties: mixSettingsSchemaProperties
            },
            reasoning: detailedReasoningSchema,
            critique: { type: "STRING", description: "Critique of the previous mix and what was changed." }
          }
        };

        const reviewPrompt = `You are a Senior Mix Engineer reviewing a work-in-progress mix. 
        Listen to the provided audio track, which is the current mix of the vocal and beat.
        
        Here are the CURRENT settings used to generate this mix:
        ${JSON.stringify(currentSettings)}
        
        Critique the current mix. Is the vocal sitting well? Is it too harsh, muddy, or buried? Is the compression too aggressive?
        Provide UPDATED settings to fix any remaining issues and improve the mix. Output JSON.`;

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
          details: `Critique: ${updatedMix.critique}\nAdjustments made.`
        });
        
        // Rate limit protection
        await delay(3000);
      }
    }

    // --- AGENT 3: Mastering Engineer ---
    onProgress({
      agent: 'Mastering Engineer',
      message: 'Reviewing final mix and applying mastering checks and balances...'
    });

    const masterSchema = {
      type: "OBJECT",
      properties: {
        settings: {
           type: "OBJECT",
           properties: {
              ...mixSettingsSchemaProperties,
              masterCompressor: {
                type: "OBJECT",
                properties: {
                  threshold: { type: "NUMBER", description: "-20 to 0 dB" },
                  ratio: { type: "NUMBER", description: "1.5 to 4" },
                  attack: { type: "NUMBER", description: "0.005 to 0.05 seconds" },
                  release: { type: "NUMBER", description: "0.1 to 0.5 seconds" }
                }
              }
           }
        },
        masteringNotes: { type: "STRING", description: "Explanation of mastering adjustments, bus compression, and final approval." }
      }
    };

    const masterPrompt = `You are a Mastering Engineer. Review the acoustic analysis and the final Mix Engineer's settings.
    Provide the final checks and balances. Adjust the settings slightly if necessary to ensure the final track is cohesive, loud, and doesn't clip. Add mastering bus compressor settings (attack, release, threshold, ratio) to glue the track together.
    
    Acoustic Analysis:
    ${analysisText}

    Final Mix Settings:
    ${JSON.stringify(currentSettings)}
    
    Output the final JSON.`;

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

    return {
      settings: finalResult.settings,
      reasoning: finalResult.masteringNotes
    };

  } catch (error: any) {
    console.error("AI Agent Network Error:", error);
    
    // Check for 429 Too Many Requests / Quota Exceeded
    const errorMessage = error?.message || '';
    if (error?.status === 429 || errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      throw new Error("API Quota Exceeded (429). The Gemini API rate limit was reached. Please try reducing the 'AI Iterations' slider to 1, or wait a minute before trying again. If you are on a free tier, you may have exhausted your daily quota.");
    }
    
    throw error;
  }
}

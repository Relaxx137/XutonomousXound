import React, { useState, useRef, useEffect } from 'react';
import { Upload, Mic, Square, Settings2, Download, Music, Loader2, Volume2, Waves, RotateCcw, Sparkles, Bot, CheckCircle2, Flame, Play, Layers, FastForward, Activity, Sliders, Ear, AlertTriangle, X, SplitSquareHorizontal, FileText, Wand2, Minimize2, History, Key, ChevronRight, ChevronLeft, HelpCircle, Eye, EyeOff } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { mixAudio, processBeat, MixSettings, defaultMixSettings, GenrePreset, applyGenrePreset, genrePresets } from './lib/audioUtils';
import { runAIAgentNetwork, AILog } from './lib/aiMixer';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeFullBuffer } from 'realtime-bpm-analyzer';

// --- Custom UI Components ---

const getAgentStyle = (agentName: string) => {
  if (agentName.includes('Analyst')) return { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: Activity };
  if (agentName.includes('Mix Engineer')) return { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: Sliders };
  if (agentName.includes('Review')) return { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Ear };
  if (agentName.includes('Mastering')) return { color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', icon: Sparkles };
  if (agentName.includes('System Error')) return { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: AlertTriangle };
  if (agentName.includes('System')) return { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: CheckCircle2 };
  return { color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20', icon: Bot };
};

const ProSlider = ({ 
  label, icon: Icon, value, min, max, step, onChange, formatValue, colorClass = "bg-violet-500", glowClass = "shadow-violet-500/50" 
}: { 
  label: string, icon: any, value: number, min: number, max: number, step: number, onChange: (v: number) => void, formatValue: (v: number) => string, colorClass?: string, glowClass?: string 
}) => {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex justify-between items-center">
        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-widest flex items-center gap-2">
          <Icon className="w-3 h-3" /> {label}
        </label>
        <span className="font-mono text-xs text-white/70 bg-white/5 px-2 py-0.5 rounded-md">{formatValue(value)}</span>
      </div>
      <div className="relative h-8 flex items-center">
        <div className="absolute w-full h-1.5 bg-white/5 rounded-full overflow-hidden backdrop-blur-sm border border-white/5">
          <motion.div 
            className={`h-full ${colorClass}`}
            initial={false}
            animate={{ width: `${percentage}%` }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
          />
        </div>
        <input 
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute w-full h-full opacity-0 cursor-pointer z-20 m-0 p-0"
          style={{ touchAction: 'none' }}
        />
        <motion.div 
          className={`absolute w-4 h-4 bg-white rounded-full shadow-[0_0_12px_rgba(255,255,255,0.8)] z-10 pointer-events-none ${glowClass}`}
          initial={false}
          animate={{ left: `calc(${percentage}% - 8px)` }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        />
      </div>
    </div>
  );
};

// --- Main App Component ---

const stepArray = ['upload', 'prepare', 'record', 'mix', 'result'] as const;
const stepNames = {
  upload: 'Upload',
  prepare: 'Prepare',
  record: 'Record',
  mix: 'Mix',
  result: 'Master'
};

// --- Tutorial steps definition ---
const TUTORIAL_STEPS = [
  {
    icon: Upload,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    title: 'Upload Your Beat',
    description: 'Start by tapping the glowing orb or dropping any audio file (MP3, WAV, etc.) onto it. This becomes the instrumental backing track for your recording.',
  },
  {
    icon: FastForward,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    title: 'Prepare the Beat',
    description: 'Fine-tune the beat\'s speed and pitch before recording. The BPM is detected automatically. You can also extract individual stems (vocals, drums, bass) using the AI separator.',
  },
  {
    icon: Mic,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
    title: 'Record Your Vocals',
    description: 'Hit the microphone button to record over the beat. Enable the metronome for timing help, or the monitor to hear yourself in real time. Record backup vocals on a second pass.',
  },
  {
    icon: Sliders,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    title: 'Mix & Master with AI',
    description: 'Manually tweak EQ, compression, reverb and more — or deploy the AI Agent Network. The AI listens to your tracks and automatically dials in professional mix settings.',
  },
  {
    icon: Download,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    title: 'Download Your Track',
    description: 'Your finished mix is exported as a high-quality WAV. Optionally upload a reference track to match its loudness and tone using AI reference mastering before downloading.',
  },
];

export default function App() {
  const [hasApiKey, setHasApiKey] = useState(true);
  const [step, setStep] = useState<'upload' | 'prepare' | 'record' | 'mix' | 'result'>('upload');
  const [isMobile, setIsMobile] = useState(false);
  const [isSmallMobile, setIsSmallMobile] = useState(false);
  const [mobileMixPanel, setMobileMixPanel] = useState<'none' | 'console' | 'ai'>('none');

  // Tutorial state
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [manualApiKey, setManualApiKey] = useState('');
  const [showKeyValue, setShowKeyValue] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState('');

  useEffect(() => {
    const checkKey = async () => {
      if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkKey();
  }, []);

  // Load saved API key and show tutorial on first visit
  useEffect(() => {
    const stored = localStorage.getItem('gemini_api_key');
    if (stored) {
      setSavedApiKey(stored);
      setManualApiKey(stored);
    }
    const seen = localStorage.getItem('tutorial_seen');
    if (!seen) {
      setShowTutorial(true);
    }
  }, []);

  const handleSaveApiKey = () => {
    const trimmed = manualApiKey.trim();
    if (!trimmed) return;
    localStorage.setItem('gemini_api_key', trimmed);
    setSavedApiKey(trimmed);
    setHasApiKey(true);
    setShowSettings(false);
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setSavedApiKey('');
    setManualApiKey('');
  };

  const closeTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem('tutorial_seen', '1');
  };

  const handleSelectKey = async () => {
    if ((window as any).aistudio && (window as any).aistudio.openSelectKey) {
      try {
        await (window as any).aistudio.openSelectKey();
        setHasApiKey(true);
      } catch (e) {
        if (e instanceof Error && e.message.includes("Requested entity was not found")) {
          setHasApiKey(false);
        }
      }
    }
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      setIsSmallMobile(window.innerWidth < 400);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Cleanup on unmount: clear polling intervals, animation frame, audio context, mic stream
  useEffect(() => {
    return () => {
      if (separationPollRef.current) clearInterval(separationPollRef.current);
      if (masteringPollRef.current) clearInterval(masteringPollRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);
  
  const [originalBeatBlob, setOriginalBeatBlob] = useState<Blob | null>(null);
  const [beatSpeed, setBeatSpeed] = useState(1.0);
  const [beatPitch, setBeatPitch] = useState(0);
  const [isProcessingBeat, setIsProcessingBeat] = useState(false);

  const [beatBlob, setBeatBlob] = useState<Blob | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [isAnalyzingBpm, setIsAnalyzingBpm] = useState(false);

  const [isSeparating, setIsSeparating] = useState(false);
  const [separatedStems, setSeparatedStems] = useState<string[]>([]);
  const [separationJobId, setSeparationJobId] = useState<string | null>(null);

  const [isMastering, setIsMastering] = useState(false);
  const [masteringJobId, setMasteringJobId] = useState<string | null>(null);
  const [masteredUrl, setMasteredUrl] = useState<string | null>(null);
  const [referenceBlob, setReferenceBlob] = useState<Blob | null>(null);
  const [history, setHistory] = useState<{id: string, name: string, date: string, url: string}[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('audio_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch {
      localStorage.removeItem('audio_history');
    }
  }, []);

  const saveToHistory = (url: string) => {
    const newItem = {
      id: Date.now().toString(),
      name: `Project ${history.length + 1}`,
      date: new Date().toLocaleString(),
      url
    };
    const newHistory = [newItem, ...history].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('audio_history', JSON.stringify(newHistory));
  };
  
  const [vocalBlob, setVocalBlob] = useState<Blob | null>(null);
  const [vocalUrl, setVocalUrl] = useState<string | null>(null);

  const [backupVocalBlob, setBackupVocalBlob] = useState<Blob | null>(null);
  const [backupVocalUrl, setBackupVocalUrl] = useState<string | null>(null);
  const [recordingMode, setRecordingMode] = useState<'main' | 'backup'>('main');
  const [useEchoCancellation, setUseEchoCancellation] = useState(false);
  
  const [mixedBlob, setMixedBlob] = useState<Blob | null>(null);
  const [mixedUrl, setMixedUrl] = useState<string | null>(null);
  
  const [beatBuffer, setBeatBuffer] = useState<AudioBuffer | null>(null);
  const [mainVocalBuffer, setMainVocalBuffer] = useState<AudioBuffer | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [settings, setSettings] = useState<MixSettings>(defaultMixSettings);
  
  const [aiIterations, setAiIterations] = useState(2);
  const [isAiMixing, setIsAiMixing] = useState(false);
  const [aiLogs, setAiLogs] = useState<AILog[]>([]);
  const [aiReasoning, setAiReasoning] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const [lyrics, setLyrics] = useState('');
  const [isGeneratingLyrics, setIsGeneratingLyrics] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [useMonitor, setUseMonitor] = useState(false);
  const [useMetronome, setUseMetronome] = useState(false);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);

  const beatAudioRef = useRef<HTMLAudioElement>(null);
  const mainVocalAudioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Visualizer Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Polling Refs
  const separationPollRef = useRef<NodeJS.Timeout | null>(null);
  const masteringPollRef = useRef<NodeJS.Timeout | null>(null);

  // Settings Module Drag to Scroll
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [isDraggingSettings, setIsDraggingSettings] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!settingsScrollRef.current) return;
    setIsDraggingSettings(true);
    setStartX(e.pageX - settingsScrollRef.current.offsetLeft);
    setScrollLeft(settingsScrollRef.current.scrollLeft);
  };

  const handleMouseLeave = () => {
    setIsDraggingSettings(false);
  };

  const handleMouseUp = () => {
    setIsDraggingSettings(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingSettings || !settingsScrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - settingsScrollRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    settingsScrollRef.current.scrollLeft = scrollLeft - walk;
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiLogs]);

  // We intentionally do not revoke object URLs on unmount to avoid breaking React 18 Strict Mode.
  // The URLs are revoked when new ones are created or when the app is reset.

  // Auto-scroll lyrics during recording
  useEffect(() => {
    let scrollInterval: any;
    if (isRecording && showLyrics && lyricsScrollRef.current) {
      const el = lyricsScrollRef.current;
      scrollInterval = setInterval(() => {
        el.scrollTop += 1;
      }, 50); // Adjust speed as needed
    }
    return () => clearInterval(scrollInterval);
  }, [isRecording, showLyrics]);

  const handleBeatUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (beatUrl) URL.revokeObjectURL(beatUrl);
      setOriginalBeatBlob(file);
      setBeatBlob(file);
      const newUrl = URL.createObjectURL(file);
      setBeatUrl(newUrl);
      setStep('prepare');
      
      // Analyze BPM
      setIsAnalyzingBpm(true);
      let bpmContext: AudioContext | null = null;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) throw new Error("AudioContext not supported");
        bpmContext = new AudioContextClass();
        if (!bpmContext) throw new Error("Failed to create AudioContext");
        const audioBuffer = await bpmContext.decodeAudioData(arrayBuffer);
        setBeatBuffer(audioBuffer);

        const bpmCandidates = await analyzeFullBuffer(audioBuffer);
        if (bpmCandidates && bpmCandidates.length > 0) {
          // The first candidate is usually the most confident one
          setDetectedBpm(Math.round(bpmCandidates[0].tempo));
        } else {
          setDetectedBpm(null);
        }
      } catch (error) {
        console.error("Failed to analyze BPM:", error);
        setDetectedBpm(null);
      } finally {
        setIsAnalyzingBpm(false);
        if (bpmContext) bpmContext.close();
      }
    }
  };

  const handlePrepareBeat = async () => {
    if (!originalBeatBlob) return;
    setIsProcessingBeat(true);
    try {
      const processedBlob = await processBeat(originalBeatBlob, beatSpeed, beatPitch);
      if (beatUrl) URL.revokeObjectURL(beatUrl);
      setBeatBlob(processedBlob);
      setBeatUrl(URL.createObjectURL(processedBlob));
      
      // Decode processed beat for AudioContext playback
      const arrayBuffer = await processedBlob.arrayBuffer();
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext not supported");
      const audioContext = new AudioContextClass();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setBeatBuffer(audioBuffer);
      audioContext.close();
      
      setStep('record');
    } catch (err) {
      console.error("Error processing beat", err);
      alert("Failed to process beat.");
    } finally {
      setIsProcessingBeat(false);
    }
  };

  const handleSeparateStems = async () => {
    if (!beatBlob) return;
    setIsSeparating(true);
    setSeparationJobId(null);
    setSeparatedStems([]);
    
    try {
      const formData = new FormData();
      formData.append('audio', beatBlob, 'beat.wav');
      
      const response = await fetch('/api/separate', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Separation request failed');
      
      const data = await response.json();
      const jobId = data.jobId;
      setSeparationJobId(jobId);
      
      // Poll for status
      if (separationPollRef.current) clearInterval(separationPollRef.current);
      separationPollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/separate/status/${jobId}`);
          const statusData = await statusRes.json();
          
          if (statusData.status === 'completed') {
            if (separationPollRef.current) clearInterval(separationPollRef.current);
            setSeparatedStems(statusData.stems || []);
            setIsSeparating(false);
          } else if (statusData.status === 'failed' || statusData.status === 'error') {
            if (separationPollRef.current) clearInterval(separationPollRef.current);
            setIsSeparating(false);
            alert('Stem separation failed.');
          }
        } catch (e) {
          console.error("Error polling separation status", e);
        }
      }, 2000);
      
    } catch (err) {
      console.error("Error starting separation", err);
      setIsSeparating(false);
      alert("Failed to start stem separation.");
    }
  };

  const handleMastering = async () => {
    if (!mixedBlob || !referenceBlob) return;
    setIsMastering(true);
    setMasteringJobId(null);
    setMasteredUrl(null);
    
    try {
      const formData = new FormData();
      formData.append('target', mixedBlob, 'mixed.wav');
      formData.append('reference', referenceBlob, 'reference.wav');
      
      const response = await fetch('/api/master', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Mastering request failed');
      
      const data = await response.json();
      const jobId = data.jobId;
      setMasteringJobId(jobId);
      
      // Poll for status
      if (masteringPollRef.current) clearInterval(masteringPollRef.current);
      masteringPollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/master/status/${jobId}`);
          const statusData = await statusRes.json();
          
          if (statusData.status === 'completed') {
            if (masteringPollRef.current) clearInterval(masteringPollRef.current);
            const url = `/api/master/download/${jobId}/${statusData.result}`;
            setMasteredUrl(url);
            saveToHistory(url);
            setIsMastering(false);
          } else if (statusData.status === 'failed' || statusData.status === 'error') {
            if (masteringPollRef.current) clearInterval(masteringPollRef.current);
            setIsMastering(false);
            alert('Mastering failed.');
          }
        } catch (e) {
          console.error("Error polling mastering status", e);
        }
      }, 2000);
      
    } catch (err) {
      console.error("Error starting mastering", err);
      setIsMastering(false);
      alert("Failed to start mastering.");
    }
  };

  const drawVisualizer = () => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = 150; // Radius of the orb

      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        const percent = value / 255;
        const barHeight = percent * 100;
        
        const angle = (i / bufferLength) * Math.PI * 2;
        
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(244, 63, 94, ${percent + 0.2})`; // Rose color
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    };
    draw();
  };

  const generateLyrics = async () => {
    if (!beatBlob) return;
    setIsGeneratingLyrics(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
      if (!apiKey) throw new Error("API Key is missing. Add one in Settings.");
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a professional songwriter. Generate lyrics for a song. 
      The user has provided some initial lyrics: "${lyrics}". 
      If the lyrics are empty, generate a full song (Verse, Chorus, Verse, Chorus, Bridge, Chorus).
      If the lyrics are not empty, continue the song from where it left off.
      The mood should match a modern hit. Return only the lyrics text.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      });

      const newLyrics = response.text;
      if (newLyrics) {
        setLyrics(prev => prev ? prev + "\n\n" + newLyrics : newLyrics);
      }
    } catch (err) {
      console.error("Error generating lyrics:", err);
    } finally {
      setIsGeneratingLyrics(false);
    }
  };

  const metronomeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Decode main vocal for backup recording playback
  useEffect(() => {
    if (vocalBlob) {
      const decode = async () => {
        try {
          const arrayBuffer = await vocalBlob.arrayBuffer();
          const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) throw new Error("AudioContext not supported");
          const audioContext = new AudioContextClass();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          setMainVocalBuffer(audioBuffer);
          audioContext.close();
        } catch (e) {
          console.error("Failed to decode main vocal:", e);
        }
      };
      decode();
    }
  }, [vocalBlob]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: useEchoCancellation,
          noiseSuppression: useEchoCancellation,
          autoGainControl: useEchoCancellation
        } 
      });
      streamRef.current = stream;
      
      // Set up Audio Context for Visualizer and Playback
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext not supported");
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;
      
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Play Beat through AudioContext (Better for Bluetooth/Sync)
      if (beatBuffer) {
        const beatSource = audioCtx.createBufferSource();
        beatSource.buffer = beatBuffer;
        const beatGain = audioCtx.createGain();
        beatGain.gain.value = 0.8;
        beatSource.connect(beatGain);
        beatGain.connect(audioCtx.destination);
        beatSource.start(0);
        (audioCtx as any).beatSource = beatSource; // Store for stopping
      }

      // Play Main Vocal if in backup mode
      if (recordingMode === 'backup' && mainVocalBuffer) {
        const vocalSource = audioCtx.createBufferSource();
        vocalSource.buffer = mainVocalBuffer;
        const vocalGain = audioCtx.createGain();
        vocalGain.gain.value = 0.6;
        vocalSource.connect(vocalGain);
        vocalGain.connect(audioCtx.destination);
        vocalSource.start(0);
        (audioCtx as any).vocalSource = vocalSource; // Store for stopping
      }

      if (useMonitor) {
        const monitorGain = audioCtx.createGain();
        monitorGain.gain.value = 0.5;
        
        const reverb = audioCtx.createConvolver();
        const sampleRate = audioCtx.sampleRate;
        const length = Math.floor(sampleRate * 0.5);
        const impulse = audioCtx.createBuffer(2, length, sampleRate);
        for (let i = 0; i < 2; i++) {
          const channelData = impulse.getChannelData(i);
          for (let j = 0; j < length; j++) {
            channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2);
          }
        }
        reverb.buffer = impulse;
        
        const reverbGain = audioCtx.createGain();
        reverbGain.gain.value = 0.2;

        source.connect(monitorGain);
        monitorGain.connect(audioCtx.destination);
        
        source.connect(reverb);
        reverb.connect(reverbGain);
        reverbGain.connect(audioCtx.destination);
      }

      if (useMetronome && detectedBpm) {
        const interval = (60 / detectedBpm) * 1000;
        metronomeIntervalRef.current = setInterval(() => {
          playMetronomeTick(audioCtx);
        }, interval);
      }
      
      const recorder = new MediaRecorder(stream);
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.current.push(e.data);
        }
      };
      
      recorder.onstop = () => {
        const blob = new Blob(audioChunks.current);
        if (recordingMode === 'main') {
          if (vocalUrl) URL.revokeObjectURL(vocalUrl);
          setVocalBlob(blob);
          setVocalUrl(URL.createObjectURL(blob));
        } else {
          if (backupVocalUrl) URL.revokeObjectURL(backupVocalUrl);
          setBackupVocalBlob(blob);
          setBackupVocalUrl(URL.createObjectURL(blob));
        }
        audioChunks.current = [];
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (audioCtxRef.current) {
          audioCtxRef.current.close();
        }
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
      
      audioChunks.current = [];
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      
      // Start visualizer
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      setTimeout(drawVisualizer, 100);
      
      // We now play beat and vocal through AudioContext for better sync and Bluetooth support
    } catch (err) {
      console.error("Error accessing microphone", err);
      alert("Could not access microphone. Please ensure permissions are granted.");
    }
  };

  const playMetronomeTick = (audioCtx: AudioContext) => {
    const osc = audioCtx.createOscillator();
    const envelope = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    envelope.gain.setValueAtTime(0, audioCtx.currentTime);
    envelope.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.connect(envelope);
    envelope.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  };

  const stopRecording = () => {
    if (metronomeIntervalRef.current) {
      clearInterval(metronomeIntervalRef.current);
      metronomeIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (beatAudioRef.current) {
        beatAudioRef.current.pause();
        beatAudioRef.current.currentTime = 0;
      }

      if (mainVocalAudioRef.current) {
        mainVocalAudioRef.current.pause();
        mainVocalAudioRef.current.currentTime = 0;
      }

      // Stop AudioContext sources
      const audioCtx = audioCtxRef.current as any;
      if (audioCtx) {
        if (audioCtx.beatSource) {
          try { audioCtx.beatSource.stop(); } catch(e) {}
        }
        if (audioCtx.vocalSource) {
          try { audioCtx.vocalSource.stop(); } catch(e) {}
        }
      }
      
      setStep('mix');
    }
  };

  const handleAutoMix = async () => {
    if (!vocalBlob || !beatBlob) return;
    
    setIsAiMixing(true);
    setAiLogs([]);
    
    try {
      const result = await runAIAgentNetwork(vocalBlob, beatBlob, backupVocalBlob, aiIterations, (log) => {
        setAiLogs(prev => [...prev, log]);
      });
      
      setSettings(result.settings);
      setAiReasoning(result.reasoning);
      
      setAiLogs(prev => [...prev, {
        agent: 'System',
        message: 'AI Agent Network has successfully configured your mix settings.',
        details: 'You can now review the settings and process the final master.'
      }]);
      
    } catch (err) {
      console.error("AI Mixing Error", err);
      setAiLogs(prev => [...prev, {
        agent: 'System Error',
        message: 'Failed to run AI Agent Network.',
        details: err instanceof Error ? err.message : 'Unknown error occurred.'
      }]);
    } finally {
      setIsAiMixing(false);
    }
  };

  const handleProcess = async () => {
    if (!vocalBlob || !beatBlob) return;
    
    setIsProcessing(true);
    try {
      const resultBlob = await mixAudio(vocalBlob, beatBlob, backupVocalBlob, settings);
      if (mixedUrl) URL.revokeObjectURL(mixedUrl);
      const url = URL.createObjectURL(resultBlob);
      setMixedBlob(resultBlob);
      setMixedUrl(url);
      saveToHistory(url);
      setStep('result');
    } catch (err) {
      console.error("Error processing audio", err);
      alert("An error occurred while processing the audio.");
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    // Memory Cleanup
    if (beatUrl) URL.revokeObjectURL(beatUrl);
    if (vocalUrl) URL.revokeObjectURL(vocalUrl);
    if (backupVocalUrl) URL.revokeObjectURL(backupVocalUrl);
    if (mixedUrl) URL.revokeObjectURL(mixedUrl);

    if (separationPollRef.current) clearInterval(separationPollRef.current);
    if (masteringPollRef.current) clearInterval(masteringPollRef.current);

    setStep('upload');
    setOriginalBeatBlob(null);
    setBeatBlob(null);
    setBeatUrl(null);
    setVocalBlob(null);
    setVocalUrl(null);
    setBackupVocalBlob(null);
    setBackupVocalUrl(null);
    setMixedBlob(null);
    setMixedUrl(null);
    setAiLogs([]);
    setSettings(defaultMixSettings);
    setRecordingMode('main');
    setBeatSpeed(1.0);
    setBeatPitch(0);
    setDetectedBpm(null);
    setSeparatedStems([]);
    setSeparationJobId(null);
    setMasteringJobId(null);
    setMasteredUrl(null);
    setReferenceBlob(null);
  };

  const handleStepSwipe = (direction: -1 | 1) => {
    const currentIndex = stepArray.indexOf(step);
    let newIndex = currentIndex + direction;
    
    while (newIndex >= 0 && newIndex < stepArray.length) {
      const s = stepArray[newIndex];
      const canNav = 
        s === 'upload' ? true :
        s === 'prepare' ? !!originalBeatBlob :
        s === 'record' ? !!beatBlob :
        s === 'mix' ? !!vocalBlob && !!beatBlob :
        s === 'result' ? !!mixedBlob : false;
        
      if (canNav) {
        setStep(s);
        break;
      }
      newIndex += direction;
    }
  };

  // Dynamic Orb Color based on step
  const getOrbColor = () => {
    switch(step) {
      case 'upload': return 'from-violet-500 via-fuchsia-600 to-indigo-900';
      case 'prepare': return 'from-blue-500 via-indigo-600 to-blue-900';
      case 'record': return isRecording ? 'from-rose-500 via-red-600 to-rose-900' : 'from-cyan-500 via-blue-600 to-cyan-900';
      case 'mix': return 'from-amber-500 via-violet-600 to-fuchsia-900';
      case 'result': return 'from-emerald-500 via-teal-600 to-emerald-900';
      default: return 'from-violet-500 via-fuchsia-600 to-indigo-900';
    }
  };

  return (
    <>
      {!hasApiKey && !savedApiKey && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 p-8 rounded-3xl max-w-md w-full shadow-2xl flex flex-col items-center text-center">
            <Sparkles className="w-12 h-12 text-amber-400 mb-6" />
            <h2 className="text-2xl font-bold text-white mb-4">API Key Required</h2>
            <p className="text-zinc-400 mb-6 leading-relaxed">
              To use the AI-powered mixing and mastering features, provide a Gemini API key.
            </p>
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={handleSelectKey}
                className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-colors uppercase tracking-widest text-sm"
              >
                Select via AI Studio
              </button>
              <button
                onClick={() => { setShowSettings(true); }}
                className="w-full py-3 bg-white/5 border border-white/10 text-white/70 font-bold rounded-xl hover:bg-white/10 transition-colors uppercase tracking-widest text-sm flex items-center justify-center gap-2"
              >
                <Key className="w-4 h-4" /> Enter Key Manually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tutorial Modal ── */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeTutorial(); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 20 }}
              className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
            >
              {/* Progress bar */}
              <div className="h-0.5 bg-white/5 w-full">
                <motion.div
                  className="h-full bg-white/30"
                  animate={{ width: `${((tutorialStep + 1) / TUTORIAL_STEPS.length) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>

              <div className="p-8 flex flex-col gap-6">
                {/* Step indicator dots */}
                <div className="flex gap-1.5 justify-center">
                  {TUTORIAL_STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setTutorialStep(i)}
                      className={`h-1 rounded-full transition-all duration-300 ${i === tutorialStep ? 'w-6 bg-white' : 'w-1.5 bg-white/20'}`}
                    />
                  ))}
                </div>

                {/* Icon + content */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tutorialStep}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-col items-center text-center gap-5"
                  >
                    {(() => {
                      const s = TUTORIAL_STEPS[tutorialStep];
                      const Icon = s.icon;
                      return (
                        <>
                          <div className={`w-16 h-16 rounded-2xl ${s.bg} border ${s.border} flex items-center justify-center`}>
                            <Icon className={`w-8 h-8 ${s.color}`} />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">
                              Step {tutorialStep + 1} of {TUTORIAL_STEPS.length}
                            </p>
                            <h3 className="text-xl font-bold text-white mb-3">{s.title}</h3>
                            <p className="text-sm text-white/60 leading-relaxed">{s.description}</p>
                          </div>
                        </>
                      );
                    })()}
                  </motion.div>
                </AnimatePresence>

                {/* Navigation */}
                <div className="flex gap-3">
                  {tutorialStep > 0 && (
                    <button
                      onClick={() => setTutorialStep(t => t - 1)}
                      className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white/60 font-bold text-sm transition-all flex items-center justify-center gap-2"
                    >
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                  )}
                  {tutorialStep < TUTORIAL_STEPS.length - 1 ? (
                    <button
                      onClick={() => setTutorialStep(t => t + 1)}
                      className="flex-1 py-3 bg-white text-black rounded-2xl font-bold text-sm hover:bg-white/90 transition-all flex items-center justify-center gap-2"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={closeTutorial}
                      className="flex-1 py-3 bg-white text-black rounded-2xl font-bold text-sm hover:bg-white/90 transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Let's Go
                    </button>
                  )}
                </div>

                {/* Skip link */}
                {tutorialStep < TUTORIAL_STEPS.length - 1 && (
                  <button onClick={closeTutorial} className="text-[10px] text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest text-center">
                    Skip tutorial
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Settings Modal ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 20 }}
              className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Settings2 className="w-4 h-4 text-white/60" />
                  </div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-white">Settings</h2>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-white/30 hover:text-white/80 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 flex flex-col gap-6">
                {/* API Key section */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      Gemini API Key
                    </label>
                    {savedApiKey && (
                      <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Saved
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/30 leading-relaxed">
                    Required for AI mixing, lyric generation, and mastering. Get a free key at{' '}
                    <span className="text-amber-400/70">aistudio.google.com</span>.
                  </p>
                  <div className="relative">
                    <input
                      type={showKeyValue ? 'text' : 'password'}
                      value={manualApiKey}
                      onChange={(e) => setManualApiKey(e.target.value)}
                      placeholder="AIza..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-10 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-white/20 font-mono transition-all"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveApiKey(); }}
                    />
                    <button
                      onClick={() => setShowKeyValue(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                    >
                      {showKeyValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveApiKey}
                      disabled={!manualApiKey.trim()}
                      className="flex-1 py-2.5 bg-white text-black font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-white/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Save Key
                    </button>
                    {savedApiKey && (
                      <button
                        onClick={handleClearApiKey}
                        className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-red-500/20 transition-all"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-white/5" />

                {/* Tutorial launcher */}
                <button
                  onClick={() => { setShowSettings(false); setTutorialStep(0); setShowTutorial(true); }}
                  className="flex items-center gap-3 w-full p-4 bg-white/3 hover:bg-white/5 border border-white/5 rounded-2xl transition-all group"
                >
                  <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                    <HelpCircle className="w-4 h-4 text-violet-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-white/70">View Tutorial</p>
                    <p className="text-[10px] text-white/30">Replay the getting started guide</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 ml-auto group-hover:text-white/50 transition-colors" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans overflow-x-hidden relative flex items-center justify-center">
      
      {/* Hidden Audio Elements for Playback */}
      {beatUrl && <audio ref={beatAudioRef} src={beatUrl} playsInline className="hidden" />}
      {vocalUrl && <audio ref={mainVocalAudioRef} src={vocalUrl} playsInline className="hidden" />}

      {/* Lyrics Overlay (Teleprompter) */}
      <AnimatePresence>
        {showLyrics && step === 'record' && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed right-8 top-32 bottom-32 w-80 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl z-40 overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-4 border-bottom border-white/5 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2 font-semibold text-xs uppercase tracking-widest text-white/60">
                <FileText className="w-4 h-4" /> Teleprompter
              </div>
              <button onClick={() => setShowLyrics(false)} className="text-white/40 hover:text-white/90">
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
            <div 
              ref={lyricsScrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth"
            >
              {lyrics ? (
                <div className="text-xl font-medium leading-relaxed text-white/90 whitespace-pre-wrap">
                  {lyrics}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                  <FileText className="w-12 h-12 text-white/10 mb-4" />
                  <p className="text-white/40 text-sm">No lyrics added yet. Add them in the Prepare step or use AI to generate some.</p>
                </div>
              )}
            </div>
            <div className="p-4 bg-white/5 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-tighter text-white/30 text-center">
                {isRecording ? "Auto-scrolling active" : "Scroll to read while recording"}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Noise */}
      <div className="fixed inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.04] mix-blend-overlay pointer-events-none z-50"></div>

      {/* Header */}
      <header className="fixed top-8 left-8 right-8 flex items-center justify-between z-50 pointer-events-none">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 pointer-events-auto"
        >
          <div className="w-10 h-10 rounded-full bg-white/5 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-xl">
            <Waves className="w-5 h-5 text-white/90" />
          </div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-white/90">
            Vocal Studio Pro
          </h1>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 pointer-events-auto"
        >
          {/* Tutorial button */}
          <button
            onClick={() => { setTutorialStep(0); setShowTutorial(true); }}
            title="How to use"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          {/* Settings button */}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            <Settings2 className="w-4 h-4" />
          </button>
          {/* Status pill */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 bg-white/5 px-4 py-2 rounded-full border border-white/10 backdrop-blur-md">
            <span className={`w-2 h-2 rounded-full animate-pulse ${savedApiKey || process.env.GEMINI_API_KEY ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            {savedApiKey || process.env.GEMINI_API_KEY ? 'SYSTEM ONLINE' : 'NO API KEY'}
          </div>
        </motion.div>
      </header>

      {/* Central 3D Orb */}
      <motion.div 
        layout
        className={`absolute orb-fluid bg-gradient-to-br ${getOrbColor()} transition-colors duration-1000 flex items-center justify-center z-10`}
        animate={{
          width: step === 'mix' ? (isMobile ? (isSmallMobile ? '220px' : '280px') : '380px') : (isMobile ? (isSmallMobile ? '200px' : '240px') : '300px'),
          height: step === 'mix' ? (isMobile ? (isSmallMobile ? '220px' : '280px') : '380px') : (isMobile ? (isSmallMobile ? '200px' : '240px') : '300px'),
          opacity: 1,
          filter: 'blur(0px)'
        }}
        transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="absolute inset-2 orb-core bg-gradient-to-tl from-white/20 to-transparent mix-blend-overlay rounded-full pointer-events-none"></div>
      </motion.div>

      {/* Main Content Area */}
      <motion.main 
        className="relative z-20 w-full max-w-6xl mx-auto px-6 min-h-screen flex items-center justify-center py-20"
        onPanEnd={(e, info) => {
          if ((e.target as HTMLElement).tagName.toLowerCase() === 'input') return;
          if (Math.abs(info.offset.x) > Math.abs(info.offset.y) && Math.abs(info.offset.x) > 50) {
            if (info.offset.x < 0) handleStepSwipe(1);
            else handleStepSwipe(-1);
          }
        }}
      >
        <AnimatePresence mode="wait">
          
          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center z-30"
            >
              <label className={`group flex flex-col items-center justify-center ${isSmallMobile ? 'w-52 h-52' : 'w-64 h-64'} rounded-full bg-black/20 backdrop-blur-md border border-white/10 cursor-pointer hover:bg-black/40 transition-all hover:scale-105 shadow-2xl`}>
                <Upload className={`${isSmallMobile ? 'w-10 h-10' : 'w-12 h-12'} text-white/80 mb-4 group-hover:-translate-y-2 transition-transform duration-500`} />
                <span className={`${isSmallMobile ? 'text-[10px]' : 'text-xs'} font-bold uppercase tracking-widest text-white/90`}>Tap Orb to Upload</span>
                <span className="text-[10px] font-mono text-white/40 mt-2">Drop beat here</span>
                <input type="file" accept="audio/*" onChange={handleBeatUpload} className="hidden" />
              </label>
            </motion.div>
          )}

          {/* STEP 1.5: PREPARE */}
          {step === 'prepare' && (
            <motion.div key="prepare" className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Center Orb Content */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="absolute z-30 flex flex-col items-center pointer-events-auto"
              >
                <button
                  onClick={handlePrepareBeat}
                  disabled={isProcessingBeat}
                  className={`${isSmallMobile ? 'w-52 h-52' : 'w-64 h-64'} rounded-full bg-black/20 backdrop-blur-md border border-white/10 flex flex-col items-center justify-center hover:bg-black/40 hover:scale-105 transition-all shadow-2xl disabled:opacity-50 disabled:hover:scale-100`}
                >
                  {isProcessingBeat ? <Loader2 className={`${isSmallMobile ? 'w-10 h-10' : 'w-12 h-12'} animate-spin text-white mb-3`} /> : <FastForward className={`${isSmallMobile ? 'w-10 h-10' : 'w-12 h-12'} text-white mb-3`} />}
                  <span className={`${isSmallMobile ? 'text-[10px]' : 'text-xs'} font-bold uppercase tracking-widest text-white text-center leading-tight`}>
                    {isProcessingBeat ? 'Processing' : 'Continue\nto Record'}
                  </span>
                </button>
              </motion.div>

              {/* Orbiting Controls */}
              <motion.div 
                initial={{ x: 0, y: 0, opacity: 0 }}
                animate={{ x: isMobile ? 0 : -280, y: isMobile ? (isSmallMobile ? -160 : -180) : 0, opacity: 1 }}
                exit={{ x: 0, y: 0, opacity: 0 }}
                transition={{ type: "spring", damping: 15 }}
                className={`absolute z-20 ${isMobile ? (isSmallMobile ? 'w-[90vw]' : 'w-72') : 'w-64'} flex flex-col gap-4 bg-black/40 backdrop-blur-2xl border border-white/10 p-6 rounded-[2rem] shadow-2xl pointer-events-auto`}
              >
                <div className="mb-6 flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/10">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono text-white/70">BPM</span>
                  </div>
                  <span className="text-sm font-bold text-white">
                    {isAnalyzingBpm ? <Loader2 className="w-4 h-4 animate-spin" /> : (detectedBpm || '--')}
                  </span>
                </div>
                <ProSlider label="Speed" icon={FastForward} value={beatSpeed} min={0.5} max={2.0} step={0.05} onChange={setBeatSpeed} formatValue={(v) => `${v.toFixed(2)}x`} colorClass="bg-blue-500" glowClass="shadow-blue-500/50" />
                {isMobile && (
                  <ProSlider label="Pitch" icon={Activity} value={beatPitch} min={-12} max={12} step={1} onChange={setBeatPitch} formatValue={(v) => v > 0 ? `+${v}` : `${v}`} colorClass="bg-indigo-500" glowClass="shadow-indigo-500/50" />
                )}
              </motion.div>

              {!isMobile && (
                <motion.div 
                  initial={{ x: 0, y: 0, opacity: 0 }}
                  animate={{ x: 280, y: 0, opacity: 1 }}
                  exit={{ x: 0, y: 0, opacity: 0 }}
                  transition={{ type: "spring", damping: 15, delay: 0.1 }}
                  className="absolute z-20 w-64 bg-black/40 backdrop-blur-2xl border border-white/10 p-6 rounded-[2rem] shadow-2xl pointer-events-auto flex flex-col gap-6"
                >
                  <ProSlider label="Pitch" icon={Activity} value={beatPitch} min={-12} max={12} step={1} onChange={setBeatPitch} formatValue={(v) => v > 0 ? `+${v}` : `${v}`} colorClass="bg-indigo-500" glowClass="shadow-indigo-500/50" />
                  
                  <div className="pt-4 border-t border-white/10">
                    <button 
                      onClick={handleSeparateStems}
                      disabled={isSeparating}
                      className="w-full py-3 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isSeparating ? <Loader2 className="w-4 h-4 animate-spin text-purple-400" /> : <SplitSquareHorizontal className="w-4 h-4 text-purple-400" />}
                      <span className="text-xs font-bold uppercase tracking-wider text-white">
                        {isSeparating ? 'Separating...' : 'Extract Stems'}
                      </span>
                    </button>
                    {separatedStems.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2">
                        {separatedStems.map((stem, i) => (
                          <a key={i} href={`/api/separate/download/${separationJobId}/${stem}`} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-purple-300 hover:text-purple-100 flex items-center gap-1 bg-purple-500/10 p-2 rounded-lg">
                            <Download className="w-3 h-3" /> {stem}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
              {/* Lyrics Panel */}
              <motion.div 
                initial={{ y: 300, opacity: 0 }}
                animate={{ y: isMobile ? (isSmallMobile ? 240 : 280) : 320, opacity: 1 }}
                exit={{ y: 300, opacity: 0 }}
                transition={{ type: "spring", damping: 15, delay: 0.2 }}
                className={`absolute z-20 ${isMobile ? (isSmallMobile ? 'w-[90vw]' : 'w-80') : 'w-96'} bg-black/40 backdrop-blur-2xl border border-white/10 p-6 rounded-[2rem] shadow-2xl pointer-events-auto flex flex-col gap-4`}
              >
                <label className="text-[10px] font-semibold text-white/40 uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-3 h-3" /> Lyrics / Songwriting
                </label>
                <div className="relative group">
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    placeholder="Write your lyrics here or use AI to generate some..."
                    className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-white/80 focus:outline-none focus:border-white/20 transition-all resize-none font-sans leading-relaxed"
                  />
                  <div className="absolute bottom-3 right-3 flex gap-2">
                    <button
                      onClick={generateLyrics}
                      disabled={isGeneratingLyrics}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white text-black rounded-full text-[10px] font-bold hover:scale-105 transition-transform disabled:opacity-50"
                    >
                      {isGeneratingLyrics ? (
                        <RotateCcw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3" />
                      )}
                      {lyrics ? 'Finish Verse' : 'AI Lyrics'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* STEP 2: RECORD */}
          {step === 'record' && (
            <motion.div key="record" className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Circular Visualizer */}
              <canvas ref={canvasRef} width={800} height={800} className={`absolute inset-0 w-full h-full object-contain opacity-50 pointer-events-none transition-opacity duration-500 z-0 ${isRecording ? 'opacity-100' : 'opacity-0'}`} />

              {/* Center Record Button */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="absolute z-30 pointer-events-auto"
              >
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`${isSmallMobile ? 'w-52 h-52' : 'w-64 h-64'} rounded-full backdrop-blur-md border-2 border-dashed flex flex-col items-center justify-center transition-all duration-500 shadow-2xl ${
                    isRecording 
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 hover:bg-rose-500/30 shadow-[0_0_60px_rgba(244,63,94,0.4)]' 
                      : 'bg-black/20 border-white/10 text-white/90 hover:bg-black/40 hover:scale-105'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Square className={`${isSmallMobile ? 'w-12 h-12' : 'w-16 h-16'} fill-current mb-2`} />
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em] animate-pulse">Recording</span>
                    </>
                  ) : (
                    <>
                      <Mic className={`${isSmallMobile ? 'w-12 h-12' : 'w-16 h-16'} mb-2`} />
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Ready</span>
                    </>
                  )}
                </button>
              </motion.div>

              {/* Orbiting Toggle */}
              <motion.div 
                initial={{ y: 0, opacity: 0 }}
                animate={{ y: isMobile ? 180 : 220, opacity: 1 }}
                exit={{ y: 0, opacity: 0 }}
                transition={{ type: "spring", damping: 15 }}
                className="absolute z-20 flex flex-col gap-4 pointer-events-auto"
              >
                <div className="flex bg-black/40 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl">
                  <button onClick={() => setUseEchoCancellation(false)} className={`px-4 sm:px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${!useEchoCancellation ? 'bg-violet-500 text-white shadow-lg' : 'text-white/40 hover:text-white/80'}`}>Headphones</button>
                  <button onClick={() => setUseEchoCancellation(true)} className={`px-4 sm:px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${useEchoCancellation ? 'bg-rose-500 text-white shadow-lg' : 'text-white/40 hover:text-white/80'}`}>Speakers</button>
                </div>
                {vocalBlob && (
                  <div className="flex bg-black/40 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl">
                    <button onClick={() => setRecordingMode('main')} className={`flex-1 px-4 sm:px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${recordingMode === 'main' ? 'bg-blue-500 text-white shadow-lg' : 'text-white/40 hover:text-white/80'}`}>Main</button>
                    <button onClick={() => setRecordingMode('backup')} className={`flex-1 px-4 sm:px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${recordingMode === 'backup' ? 'bg-pink-500 text-white shadow-lg' : 'text-white/40 hover:text-white/80'}`}>Backup</button>
                  </div>
                )}
                <div className="flex bg-black/40 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl">
                  <button 
                    onClick={() => setUseMonitor(!useMonitor)} 
                    className={`flex-1 px-4 sm:px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${useMonitor ? 'bg-emerald-500 text-white shadow-lg' : 'text-white/40 hover:text-white/80'}`}
                  >
                    <Ear className="w-3 h-3" /> {useMonitor ? 'Monitor ON' : 'Monitor OFF'}
                  </button>
                  <button 
                    onClick={() => setUseMetronome(!useMetronome)} 
                    className={`flex-1 px-4 sm:px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${useMetronome ? 'bg-amber-500 text-white shadow-lg' : 'text-white/40 hover:text-white/80'}`}
                  >
                    <Activity className="w-3 h-3" /> {useMetronome ? 'Click ON' : 'Click OFF'}
                  </button>
                </div>
              </motion.div>
              
              <motion.div 
                initial={{ y: 0, opacity: 0 }}
                animate={{ y: isMobile ? -180 : -220, opacity: 1 }}
                exit={{ y: 0, opacity: 0 }}
                transition={{ type: "spring", damping: 15, delay: 0.1 }}
                className="absolute z-20 text-center pointer-events-auto"
              >
                <h2 className="text-2xl font-bold tracking-widest uppercase text-white/90 mb-1 font-mono">
                  {recordingMode === 'main' ? 'Vocal Tracking' : 'Backup Tracking'}
                </h2>
                <div className={`text-[10px] font-mono px-4 py-1.5 rounded-full border inline-block ${isRecording ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-white/5 border-white/10 text-white/40'}`}>
                  {isRecording ? 'REC ● 00:00:00' : 'READY TO RECORD'}
                </div>

                {!showLyrics && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => setShowLyrics(true)}
                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] uppercase tracking-widest text-white/60 hover:bg-white/10 transition-colors pointer-events-auto"
                  >
                    <FileText className="w-3 h-3" /> Show Teleprompter
                  </motion.button>
                )}
              </motion.div>
            </motion.div>
          )}

          {/* STEP 3: MIX */}
          {step === 'mix' && (
            <motion.div
              key="mix"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              {/* Mobile Panel Toggles */}
              {isMobile && mobileMixPanel === 'none' && (
                <motion.div 
                  initial={{ y: -50, opacity: 0 }}
                  animate={{ y: -180, opacity: 1 }}
                  className="absolute z-20 flex gap-4 pointer-events-auto"
                >
                  <button onClick={() => setMobileMixPanel('console')} className="px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-black/40 backdrop-blur-2xl border border-white/10 text-white shadow-2xl flex items-center gap-2">
                    <Settings2 className="w-4 h-4" /> Console
                  </button>
                  <button onClick={() => setMobileMixPanel('ai')} className="px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-black/40 backdrop-blur-2xl border border-white/10 text-amber-400 shadow-2xl flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> AI Agent
                  </button>
                </motion.div>
              )}

              {/* Left Flank: Professional Mix Console */}
              <AnimatePresence>
                {(!isMobile || mobileMixPanel === 'console') && (
                  <motion.div 
                    initial={{ x: isMobile ? 0 : -100, y: isMobile ? 50 : 0, opacity: 0 }}
                    animate={{ x: isMobile ? 0 : -380, y: isMobile ? 0 : 0, scale: 1, opacity: 1 }}
                    exit={{ x: isMobile ? 0 : -100, y: isMobile ? 50 : 0, opacity: 0 }}
                    className={`absolute z-40 ${isMobile ? (isSmallMobile ? 'w-[92vw]' : 'w-80') : 'w-80'} bg-black/80 backdrop-blur-3xl border border-white/10 p-5 rounded-[2rem] shadow-2xl flex flex-col gap-3 max-h-[80vh] overflow-y-auto no-scrollbar pointer-events-auto ${isMobile ? 'h-[70vh] pb-20' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <h2 className="text-lg font-bold uppercase tracking-widest text-white/90 flex items-center gap-2">
                          <Settings2 className="w-4 h-4" /> Console
                        </h2>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">Production-grade DSP engine</p>
                      </div>
                      {isMobile && (
                        <button onClick={() => setMobileMixPanel('none')} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <X className="w-4 h-4 text-white" />
                        </button>
                      )}
                    </div>

                    {/* ── Genre Preset Selector ── */}
                    <div className="bg-white/5 rounded-xl border border-white/10 p-3">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-2 block">Genre Preset</label>
                      <div className="grid grid-cols-4 gap-1">
                        {(['hip-hop', 'pop', 'electronic', 'acoustic'] as const).map(g => (
                          <button
                            key={g}
                            onClick={() => {
                              const preset = applyGenrePreset(g);
                              setSettings(preset);
                            }}
                            className={`px-2 py-2 rounded-lg text-[8px] font-bold uppercase tracking-wider transition-all ${settings.genrePreset === g ? 'bg-violet-500 text-white shadow-lg' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'}`}
                          >
                            {g === 'hip-hop' ? 'HIP HOP' : g === 'electronic' ? 'EDM' : g.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── Vocal Chain ── */}
                    <details open className="group">
                      <summary className="flex items-center gap-2 cursor-pointer select-none py-2 px-3 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                        <Mic className="w-3 h-3 text-violet-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400 flex-1">Vocal Chain</span>
                        <ChevronRight className="w-3 h-3 text-violet-400/50 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2 flex flex-col gap-3 pl-1">
                        <ProSlider label="Vocal Level" icon={Mic} value={settings.vocalVolume} min={0} max={2} step={0.05} onChange={(v) => setSettings({...settings, vocalVolume: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-violet-500" glowClass="shadow-violet-500/50" />
                        {backupVocalBlob && (
                          <ProSlider label="Backup Level" icon={Layers} value={settings.backupVolume} min={0} max={2} step={0.05} onChange={(v) => setSettings({...settings, backupVolume: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-pink-500" glowClass="shadow-pink-500/50" />
                        )}
                        {/* EQ */}
                        <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                          <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 block mb-2">EQ</span>
                          <div className="flex flex-col gap-2">
                            <ProSlider label="HPF Cutoff" icon={Activity} value={settings.vocalEQ.lowCutFreq} min={60} max={200} step={5} onChange={(v) => setSettings({...settings, vocalEQ: {...settings.vocalEQ, lowCutFreq: v}})} formatValue={(v) => `${v}Hz`} colorClass="bg-violet-400" glowClass="shadow-violet-400/50" />
                            <ProSlider label="Mud Cut" icon={Activity} value={settings.vocalEQ.lowMidGain} min={-8} max={4} step={0.5} onChange={(v) => setSettings({...settings, vocalEQ: {...settings.vocalEQ, lowMidGain: v}})} formatValue={(v) => `${v > 0 ? '+' : ''}${v}dB`} colorClass="bg-violet-400" glowClass="shadow-violet-400/50" />
                            <ProSlider label="Presence" icon={Activity} value={settings.vocalEQ.presenceGain} min={-4} max={6} step={0.5} onChange={(v) => setSettings({...settings, vocalEQ: {...settings.vocalEQ, presenceGain: v}})} formatValue={(v) => `${v > 0 ? '+' : ''}${v}dB`} colorClass="bg-violet-400" glowClass="shadow-violet-400/50" />
                            <ProSlider label="Air" icon={Activity} value={settings.vocalEQ.airGain} min={0} max={6} step={0.5} onChange={(v) => setSettings({...settings, vocalEQ: {...settings.vocalEQ, airGain: v}})} formatValue={(v) => `+${v}dB`} colorClass="bg-violet-400" glowClass="shadow-violet-400/50" />
                          </div>
                        </div>
                        {/* De-Esser */}
                        <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">De-Esser</span>
                            <button onClick={() => setSettings({...settings, deEsser: {...settings.deEsser, enabled: !settings.deEsser.enabled}})} className={`text-[8px] px-2 py-0.5 rounded-full font-bold ${settings.deEsser.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-white/30 border border-white/10'}`}>
                              {settings.deEsser.enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          {settings.deEsser.enabled && (
                            <div className="flex flex-col gap-2">
                              <ProSlider label="Frequency" icon={Activity} value={settings.deEsser.frequency} min={4000} max={10000} step={100} onChange={(v) => setSettings({...settings, deEsser: {...settings.deEsser, frequency: v}})} formatValue={(v) => `${(v/1000).toFixed(1)}kHz`} colorClass="bg-amber-500" glowClass="shadow-amber-500/50" />
                              <ProSlider label="Threshold" icon={Activity} value={settings.deEsser.threshold} min={-40} max={-10} step={1} onChange={(v) => setSettings({...settings, deEsser: {...settings.deEsser, threshold: v}})} formatValue={(v) => `${v}dB`} colorClass="bg-amber-500" glowClass="shadow-amber-500/50" />
                            </div>
                          )}
                        </div>
                        {/* Compression */}
                        <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                          <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 block mb-2">Compressor</span>
                          <div className="flex flex-col gap-2">
                            <ProSlider label="Threshold" icon={Activity} value={settings.vocalCompressor.threshold} min={-40} max={-10} step={1} onChange={(v) => setSettings({...settings, vocalCompressor: {...settings.vocalCompressor, threshold: v}})} formatValue={(v) => `${v}dB`} colorClass="bg-rose-500" glowClass="shadow-rose-500/50" />
                            <ProSlider label="Ratio" icon={Activity} value={settings.vocalCompressor.ratio} min={2} max={8} step={0.5} onChange={(v) => setSettings({...settings, vocalCompressor: {...settings.vocalCompressor, ratio: v}})} formatValue={(v) => `${v}:1`} colorClass="bg-rose-500" glowClass="shadow-rose-500/50" />
                          </div>
                        </div>
                        {/* Parallel Compression */}
                        <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">Parallel Comp (NY)</span>
                            <button onClick={() => setSettings({...settings, parallelCompression: {...settings.parallelCompression, enabled: !settings.parallelCompression.enabled}})} className={`text-[8px] px-2 py-0.5 rounded-full font-bold ${settings.parallelCompression.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-white/30 border border-white/10'}`}>
                              {settings.parallelCompression.enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          {settings.parallelCompression.enabled && (
                            <ProSlider label="Blend" icon={Activity} value={settings.parallelCompression.wetDry} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, parallelCompression: {...settings.parallelCompression, wetDry: v}})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-rose-400" glowClass="shadow-rose-400/50" />
                          )}
                        </div>
                        {/* FX */}
                        <ProSlider label="Saturation" icon={Flame} value={settings.saturation} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, saturation: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-orange-500" glowClass="shadow-orange-500/50" />
                        <ProSlider label="Reverb" icon={Waves} value={settings.reverb} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, reverb: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-cyan-500" glowClass="shadow-cyan-500/50" />
                        <ProSlider label="Reverb Decay" icon={Waves} value={settings.reverbDecay} min={0.5} max={5} step={0.1} onChange={(v) => setSettings({...settings, reverbDecay: v})} formatValue={(v) => `${v.toFixed(1)}s`} colorClass="bg-cyan-400" glowClass="shadow-cyan-400/50" />
                        <ProSlider label="Delay" icon={Volume2} value={settings.echo} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, echo: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-emerald-500" glowClass="shadow-emerald-500/50" />
                        <ProSlider label="Doubler" icon={SplitSquareHorizontal} value={settings.doubler} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, doubler: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-indigo-500" glowClass="shadow-indigo-500/50" />
                      </div>
                    </details>

                    {/* ── Beat Chain ── */}
                    <details className="group">
                      <summary className="flex items-center gap-2 cursor-pointer select-none py-2 px-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <Music className="w-3 h-3 text-blue-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 flex-1">Beat Chain</span>
                        <ChevronRight className="w-3 h-3 text-blue-400/50 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2 flex flex-col gap-3 pl-1">
                        <ProSlider label="Beat Level" icon={Music} value={settings.beatVolume} min={0} max={2} step={0.05} onChange={(v) => setSettings({...settings, beatVolume: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-blue-500" glowClass="shadow-blue-500/50" />
                        <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                          <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 block mb-2">Beat EQ</span>
                          <div className="flex flex-col gap-2">
                            <ProSlider label="Bass" icon={Activity} value={settings.beatEQ.lowGain} min={-6} max={6} step={0.5} onChange={(v) => setSettings({...settings, beatEQ: {...settings.beatEQ, lowGain: v}})} formatValue={(v) => `${v > 0 ? '+' : ''}${v}dB`} colorClass="bg-blue-400" glowClass="shadow-blue-400/50" />
                            <ProSlider label="Low-Mid" icon={Activity} value={settings.beatEQ.lowMidGain} min={-6} max={6} step={0.5} onChange={(v) => setSettings({...settings, beatEQ: {...settings.beatEQ, lowMidGain: v}})} formatValue={(v) => `${v > 0 ? '+' : ''}${v}dB`} colorClass="bg-blue-400" glowClass="shadow-blue-400/50" />
                            <ProSlider label="Vocal Space Cut" icon={Activity} value={settings.beatEQ.highMidGain} min={-6} max={6} step={0.5} onChange={(v) => setSettings({...settings, beatEQ: {...settings.beatEQ, highMidGain: v}})} formatValue={(v) => `${v > 0 ? '+' : ''}${v}dB`} colorClass="bg-blue-400" glowClass="shadow-blue-400/50" />
                            <ProSlider label="Highs" icon={Activity} value={settings.beatEQ.highGain} min={-6} max={6} step={0.5} onChange={(v) => setSettings({...settings, beatEQ: {...settings.beatEQ, highGain: v}})} formatValue={(v) => `${v > 0 ? '+' : ''}${v}dB`} colorClass="bg-blue-400" glowClass="shadow-blue-400/50" />
                          </div>
                        </div>
                        <ProSlider label="Sidechain Duck" icon={Activity} value={settings.sidechainDuck} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, sidechainDuck: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-blue-300" glowClass="shadow-blue-300/50" />
                      </div>
                    </details>

                    {/* ── Mastering Chain ── */}
                    <details className="group">
                      <summary className="flex items-center gap-2 cursor-pointer select-none py-2 px-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                        <Sparkles className="w-3 h-3 text-rose-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400 flex-1">Mastering</span>
                        <ChevronRight className="w-3 h-3 text-rose-400/50 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2 flex flex-col gap-3 pl-1">
                        <ProSlider label="Stereo Width" icon={SplitSquareHorizontal} value={settings.stereoImaging.width} min={0.5} max={2} step={0.05} onChange={(v) => setSettings({...settings, stereoImaging: {...settings.stereoImaging, width: v}})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-rose-500" glowClass="shadow-rose-500/50" />
                        <ProSlider label="Bass Mono" icon={Activity} value={settings.stereoImaging.bassMonoCutoff} min={0} max={300} step={10} onChange={(v) => setSettings({...settings, stereoImaging: {...settings.stereoImaging, bassMonoCutoff: v}})} formatValue={(v) => `${v}Hz`} colorClass="bg-rose-400" glowClass="shadow-rose-400/50" />
                        <ProSlider label="Soft Clip" icon={Activity} value={settings.softClipAmount} min={0} max={1} step={0.05} onChange={(v) => setSettings({...settings, softClipAmount: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-rose-400" glowClass="shadow-rose-400/50" />
                        <ProSlider label="Master Gain" icon={Volume2} value={settings.masterGain} min={0.5} max={2} step={0.05} onChange={(v) => setSettings({...settings, masterGain: v})} formatValue={(v) => `${Math.round(v * 100)}%`} colorClass="bg-rose-500" glowClass="shadow-rose-500/50" />
                        <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                          <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 block mb-2">Limiter</span>
                          <div className="flex flex-col gap-2">
                            <ProSlider label="Ceiling" icon={Activity} value={settings.masterLimiter.ceiling} min={-3} max={0} step={0.1} onChange={(v) => setSettings({...settings, masterLimiter: {...settings.masterLimiter, ceiling: v}})} formatValue={(v) => `${v.toFixed(1)} dBTP`} colorClass="bg-red-500" glowClass="shadow-red-500/50" />
                          </div>
                        </div>
                        <div className="bg-gradient-to-r from-amber-500/10 to-rose-500/10 rounded-lg p-3 border border-amber-500/20">
                          <ProSlider label="LUFS Target" icon={Activity} value={settings.lufsTarget} min={-14} max={-6} step={0.5} onChange={(v) => setSettings({...settings, lufsTarget: v})} formatValue={(v) => `${v} LUFS`} colorClass="bg-amber-500" glowClass="shadow-amber-500/50" />
                        </div>
                      </div>
                    </details>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Center Orb Content: Process Button */}
              <AnimatePresence>
                {(!isMobile || mobileMixPanel === 'none') && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute z-30 flex flex-col items-center pointer-events-auto"
                  >
                    <button
                      onClick={handleProcess}
                      disabled={isProcessing || isAiMixing}
                      className={`${isSmallMobile ? 'w-52 h-52' : 'w-64 h-64'} rounded-full bg-black/20 backdrop-blur-md border border-white/10 flex flex-col items-center justify-center hover:bg-black/40 hover:scale-105 transition-all shadow-2xl disabled:opacity-50 disabled:hover:scale-100`}
                    >
                      {isProcessing ? <Loader2 className={`${isSmallMobile ? 'w-10 h-10' : 'w-12 h-12'} animate-spin text-white/90 mb-3`} /> : <Layers className={`${isSmallMobile ? 'w-10 h-10' : 'w-12 h-12'} text-white/90 mb-3`} />}
                      <span className={`${isSmallMobile ? 'text-[10px]' : 'text-xs'} font-bold uppercase tracking-widest text-white/90 text-center leading-tight`}>
                        {isProcessing ? 'Mastering...' : 'Process\n&\nMaster'}
                      </span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Right Flank: AI Terminal */}
              <AnimatePresence>
                {(!isMobile || mobileMixPanel === 'ai') && (
                  <motion.div 
                    initial={{ x: isMobile ? 0 : 100, y: isMobile ? 50 : 0, opacity: 0 }}
                    animate={{ x: isMobile ? 0 : 380, y: isMobile ? 0 : 0, scale: 1, opacity: 1 }}
                    exit={{ x: isMobile ? 0 : 100, y: isMobile ? 50 : 0, opacity: 0 }}
                    className={`absolute z-40 ${isMobile ? (isSmallMobile ? 'w-[92vw]' : 'w-80') : 'w-80'} bg-black/80 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl flex flex-col gap-4 max-h-[80vh] pointer-events-auto ${isMobile ? 'h-[70vh] pb-20' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h2 className="text-lg font-bold uppercase tracking-widest text-white/90 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-400" /> AI Agent
                        </h2>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">Autonomous multi-pass mixing</p>
                      </div>
                      {isMobile && (
                        <button onClick={() => setMobileMixPanel('none')} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <X className="w-4 h-4 text-white" />
                        </button>
                      )}
                    </div>
                    
                    <div className="flex-1 bg-[#050505] rounded-xl border border-white/10 p-4 overflow-y-auto font-mono text-[10px] shadow-[inset_0_0_20px_rgba(0,0,0,0.8)] no-scrollbar min-h-[200px]">
                      {aiLogs.length === 0 && !isAiMixing ? (
                        <div className="h-full flex flex-col items-center justify-center text-white/20 text-center p-2">
                          <Bot className="w-8 h-8 mb-2 opacity-20" />
                          <p>Agent network is standing by.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {aiLogs.map((log, index) => {
                            const style = getAgentStyle(log.agent);
                            const Icon = style.icon;
                            return (
                              <motion.div key={index} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="relative">
                                {index !== aiLogs.length - 1 && <div className="absolute left-[11px] top-6 bottom-[-16px] w-[1px] bg-white/5" />}
                                <div className="flex gap-3">
                                  <div className={`relative z-10 flex-shrink-0 w-6 h-6 rounded-full ${style.bg} ${style.border} border flex items-center justify-center`}>
                                    <Icon className={`w-3 h-3 ${style.color}`} />
                                  </div>
                                  <div className="flex-1 pt-1">
                                    <div className={`font-semibold mb-0.5 text-[9px] uppercase tracking-wider ${style.color}`}>{log.agent}</div>
                                    <div className="text-white/80 leading-relaxed mb-1">{log.message}</div>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                          {isAiMixing && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                              <div className="relative z-10 flex-shrink-0 w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                                <Loader2 className="w-3 h-3 text-white/40 animate-spin" />
                              </div>
                              <div className="flex-1 pt-1.5">
                                <div className="flex items-center text-white/40 text-[9px] uppercase tracking-widest">Processing...</div>
                              </div>
                            </motion.div>
                          )}
                          <div ref={logsEndRef} />
                        </div>
                      )}
                    </div>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                      <ProSlider label="AI Passes" icon={Bot} value={aiIterations} min={1} max={4} step={1} onChange={(v) => setAiIterations(v)} formatValue={(v) => `${v}`} colorClass="bg-amber-500" glowClass="shadow-amber-500/50" />
                    </div>

                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleAutoMix} disabled={isAiMixing || isProcessing} className="w-full py-3 px-4 rounded-xl text-[10px] font-bold uppercase tracking-widest text-black bg-amber-400 hover:bg-amber-300 transition-colors shadow-[0_0_20px_rgba(251,191,36,0.3)] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                      {isAiMixing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Network Active...</> : <><Sparkles className="w-4 h-4 mr-2" /> Deploy AI Agent</>}
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* STEP 4: RESULT */}
          {step === 'result' && mixedUrl && (
            <motion.div key="result" className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-8 w-full max-w-5xl px-6 relative">
                
                {/* Main Content */}
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={`w-full bg-black/40 backdrop-blur-3xl border border-white/10 ${isSmallMobile ? 'p-4 rounded-[2rem]' : 'p-8 rounded-[3rem]'} shadow-2xl flex flex-col items-center gap-8 pointer-events-auto`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className={`${isSmallMobile ? 'w-12 h-12' : 'w-16 h-16'} rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mb-2`}>
                      <CheckCircle2 className={`${isSmallMobile ? 'w-6 h-6' : 'w-8 h-8'} text-emerald-400`} />
                    </div>
                    <h2 className={`${isSmallMobile ? 'text-xl' : 'text-2xl'} font-bold uppercase tracking-[0.2em] text-white text-center`}>Master Complete</h2>
                    <p className="text-[10px] uppercase tracking-widest text-white/40">High-fidelity export ready</p>
                  </div>

                  <div className="w-full max-w-md bg-white/5 rounded-2xl p-4 border border-white/5">
                    <audio src={masteredUrl || mixedUrl} controls playsInline className="w-full h-10 outline-none opacity-90 invert hue-rotate-180 grayscale contrast-150" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                    <div className="bg-white/5 p-5 rounded-2xl border border-white/5 flex flex-col gap-4">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                        <Activity className="w-3 h-3" /> Report
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-white/60">Target LUFS</span>
                          <span className="font-mono text-amber-400">{settings.lufsTarget} LUFS</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-white/60">Peak Ceiling</span>
                          <span className="font-mono text-white/40">{settings.masterLimiter.ceiling.toFixed(1)} dBTP</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-white/60">Stereo Width</span>
                          <span className="font-mono text-white/40">{Math.round(settings.stereoImaging.width * 100)}%</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-white/60">Format</span>
                          <span className="font-mono text-emerald-400">WAV 44.1kHz</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-white/60">Genre</span>
                          <span className="font-mono text-violet-400 uppercase">{settings.genrePreset}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 p-5 rounded-2xl border border-white/5 flex flex-col gap-4">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                        <Sparkles className="w-3 h-3" /> AI Notes
                      </h3>
                      <p className="text-[10px] text-white/70 leading-relaxed italic line-clamp-4">
                        "{aiReasoning || "The AI network balanced the frequencies and applied bus compression to glue the tracks together."}"
                      </p>
                    </div>

                    <div className="bg-white/5 p-5 rounded-2xl border border-white/5 flex flex-col gap-4">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                        <History className="w-3 h-3" /> History
                      </h3>
                      <div className="space-y-2 max-h-24 overflow-y-auto no-scrollbar">
                        {history.map(item => (
                          <div key={item.id} className="flex justify-between items-center text-[9px] bg-white/5 p-2 rounded-lg border border-white/5">
                            <span className="text-white/60 truncate max-w-[80px]">{item.name}</span>
                            <a href={item.url} download className="text-emerald-400 hover:text-emerald-300">
                              <Download className="w-3 h-3" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={`flex ${isSmallMobile ? 'flex-col' : ''} gap-4 w-full`}>
                    <a
                      href={masteredUrl || mixedUrl}
                      download="mastered_track.wav"
                      className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                    >
                      <Download className="w-5 h-5" /> Download
                    </a>
                    <div className="flex gap-4 flex-1">
                      <button
                        onClick={() => setStep('mix')}
                        className="flex-1 px-4 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2"
                      >
                        <Settings2 className="w-5 h-5" /> Tweak
                      </button>
                      <button
                        onClick={reset}
                        className="flex-1 px-4 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white/40 font-bold uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2"
                      >
                        <RotateCcw className="w-5 h-5" /> New
                      </button>
                    </div>
                  </div>
                </motion.div>

                {/* Side Panel: Reference Mastering */}
                <motion.div 
                  initial={{ x: 100, opacity: 0 }}
                  animate={{ x: isMobile ? 0 : 480, y: isMobile ? 320 : 0, opacity: 1 }}
                  className="absolute z-20 w-64 bg-black/40 backdrop-blur-2xl border border-white/10 p-6 rounded-[2rem] shadow-2xl pointer-events-auto flex flex-col gap-4"
                >
                  <h3 className="text-xs font-bold uppercase tracking-widest text-white/80 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" /> AI Mastering
                  </h3>
                  <label className="flex flex-col items-center justify-center w-full h-24 rounded-xl bg-white/5 border border-white/10 border-dashed cursor-pointer hover:bg-white/10 transition-all">
                    <Upload className="w-6 h-6 text-white/50 mb-2" />
                    <span className="text-[10px] font-mono text-white/50">
                      {referenceBlob ? 'Reference Loaded' : 'Upload Reference'}
                    </span>
                    <input type="file" accept="audio/*" onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setReferenceBlob(e.target.files[0]);
                      }
                    }} className="hidden" />
                  </label>
                  
                  <button 
                    onClick={handleMastering}
                    disabled={!referenceBlob || isMastering}
                    className="w-full py-3 px-4 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {isMastering ? <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> : <Layers className="w-4 h-4 text-amber-400" />}
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      {isMastering ? 'Mastering...' : 'Match Reference'}
                    </span>
                  </button>
                </motion.div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.main>

      {/* Infinity Wheel Step Navigation */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-3xl px-6 pointer-events-none">
        <div className="relative flex items-center justify-center bg-black/40 backdrop-blur-2xl border border-white/10 rounded-full h-24 shadow-2xl overflow-hidden pointer-events-auto" style={{ perspective: '1200px' }}>
          <motion.div 
            className="relative w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing" 
            style={{ transformStyle: 'preserve-3d', touchAction: 'none' }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.1}
            onDragEnd={(e, info) => {
              if (info.offset.x < -40) handleStepSwipe(1);
              if (info.offset.x > 40) handleStepSwipe(-1);
            }}
          >
            <AnimatePresence>
              {stepArray.map((s, i) => {
                const isActive = step === s;
                const currentIndex = stepArray.indexOf(step);
                const offset = i - currentIndex;
                const distance = Math.abs(offset);
                
                const scale = isActive ? 1.2 : Math.max(0.7, 1 - distance * 0.15);
                const opacity = isActive ? 1 : Math.max(0.0, 0.5 - distance * 0.2);
                const translateX = offset * (isSmallMobile ? 90 : 110); // Spacing
                const translateZ = -distance * 60; // Depth
                const rotateY = offset * -25; // Curve
                
                const canNav = 
                  s === 'upload' ? true :
                  s === 'prepare' ? !!originalBeatBlob :
                  s === 'record' ? !!beatBlob :
                  s === 'mix' ? !!vocalBlob && !!beatBlob :
                  s === 'result' ? !!mixedBlob : false;

                return (
                  <motion.button 
                    key={s}
                    onClick={() => canNav && setStep(s)}
                    disabled={!canNav}
                    initial={false}
                    animate={{ 
                      x: translateX,
                      z: translateZ,
                      rotateY: rotateY,
                      scale: scale,
                      opacity: canNav ? opacity : 0.15,
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    className={`absolute text-[10px] sm:text-xs font-bold uppercase tracking-widest whitespace-nowrap px-4 py-2 rounded-full transition-colors ${isActive ? 'text-white bg-white/10 drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]' : 'text-white/50'} ${!canNav ? 'cursor-not-allowed' : 'hover:text-white hover:bg-white/5'}`}
                    style={{ zIndex: 10 - distance }}
                  >
                    {stepNames[s]}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </div>
    </>
  );
}

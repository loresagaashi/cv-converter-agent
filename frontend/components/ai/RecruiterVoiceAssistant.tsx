"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { createConversationTurn, generateConversationCompetencePaper, startConversationSession, playTextToSpeech } from "@/lib/api";

// MediaRecorder and AudioContext types are built-in to TypeScript

type SectionKey =
  | "core_skills"
  | "soft_skills"
  | "languages"
  | "education"
  | "trainings_certifications"
  | "technical_competencies"
  | "project_experience"
  | "recommendations"
  | "additional_info";

interface HistoryItem {
  role: "assistant" | "recruiter";
  content: string;
}

interface RecruiterVoiceAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  cvId: number;
  paperId: number;
}

type StatusState = "idle" | "speaking" | "listening" | "thinking" | "generating" | "completed" | "finished" | "error";

const SECTION_ORDER: SectionKey[] = [
  "core_skills",
  "soft_skills",
  "languages",
  "education",
  "trainings_certifications",
  "technical_competencies",
  "project_experience",
  "recommendations",
  "additional_info",
];

const MAX_QUESTIONS_PER_SECTION: Record<SectionKey, number> = {
  core_skills: 5,
  soft_skills: 2,
  languages: 3,
  education: 2,
  trainings_certifications: 2,
  technical_competencies: 5,
  project_experience: 4,
  recommendations: 2,
  additional_info: 10, // Allow more questions for additional info collection
};

/**
 * Voice-only recruiter assistant UI.
 *
   * - Shows the latest live transcription ("You said:") on screen.
 * - Uses browser speech synthesis / recognition for audio I/O.
 * - Uses backend /api/llm/recruiter-assistant/question/ (gpt-4o-mini) for reasoning.
 */
export function RecruiterVoiceAssistant({
  isOpen,
  onClose,
  cvId,
  paperId,
}: RecruiterVoiceAssistantProps) {
  const { token } = useAuth();

  const [status, setStatus] = useState<StatusState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("core_skills");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isGeneratingPaper, setIsGeneratingPaper] = useState(false);
  const [hasGeneratedPaper, setHasGeneratedPaper] = useState(false);
  const [generatedPaperId, setGeneratedPaperId] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string>("");

  const historyRef = useRef<HistoryItem[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const volumeCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);
  const loggedVoiceRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null); // Use ref to always have latest sessionId
  const sectionQuestionCountRef = useRef<Record<SectionKey, number>>({
    core_skills: 0,
    soft_skills: 0,
    languages: 0,
    education: 0,
    trainings_certifications: 0,
    technical_competencies: 0,
    project_experience: 0,
    recommendations: 0,
    additional_info: 0,
  });

  const speak = async (text: string): Promise<void> => {
    if (!token) {
      throw new Error("Missing auth token for TTS.");
    }

    try {
      // FAST WAY: Show "thinking" while audio is downloading
      const downloadStart = performance.now();
      setStatus("thinking");
      //console.log(`[TIMING] TTS download started`);
      const audio = await playTextToSpeech(text, token);
      const downloadEnd = performance.now();
      currentAudioRef.current = audio;
      //console.log(`[TIMING] TTS download completed: ${(downloadEnd - downloadStart).toFixed(0)}ms`);

      return new Promise((resolve, reject) => {
        // Set status to "speaking" right when audio starts playing
        const playStart = performance.now();
        setStatus("speaking");
        //console.log(`[TIMING] Audio playback started`);

        audio.onended = () => {
          const playEnd = performance.now();
          currentAudioRef.current = null;
          //console.log(`[TIMING] Audio playback ended - Duration: ${(playEnd - playStart).toFixed(0)}ms`);
          resolve();
        };
        audio.onerror = () => {
          currentAudioRef.current = null;
          reject(new Error("Audio playback error"));
        };
        audio.play().catch(reject);
      });
    } catch (err) {
      console.error("[speak] TTS error:", err);
      currentAudioRef.current = null;
      throw err;
    }
  };

  const startListening = (): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Setup MediaRecorder
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm',
        });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        // Setup AudioContext for volume monitoring
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyserRef.current = analyser;
        analyser.fftSize = 256;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const SILENCE_THRESHOLD = 0.03; // Volume threshold for silence detection (3% - raised to avoid background noise)
        const SILENCE_DURATION_MS = 2000; // 2 seconds of silence (reduced from 2.5s for faster response)
        let lastSoundTime = Date.now();

        // Monitor volume for silence detection
        const checkVolume = () => {
          if (!analyserRef.current) return;

          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / bufferLength;
          const volume = average / 255;

          if (volume > SILENCE_THRESHOLD) {
            lastSoundTime = Date.now();
          } else {
            const silenceDuration = Date.now() - lastSoundTime;
            if (silenceDuration >= SILENCE_DURATION_MS) {
              // Silence detected - stop recording
              stopListening();
            }
          }
        };

        volumeCheckIntervalRef.current = setInterval(checkVolume, 100);

        // Collect audio chunks
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        // Handle recording stop
        mediaRecorder.onstop = async () => {
          // Clear intervals and contexts
          if (volumeCheckIntervalRef.current) {
            clearInterval(volumeCheckIntervalRef.current);
            volumeCheckIntervalRef.current = null;
          }
          if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            try {
              audioContextRef.current.close();
            } catch (err) {
              console.error("[startListening] Error closing AudioContext:", err);
            }
          }
          audioContextRef.current = null;

          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());

          // Create blob from chunks
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          audioChunksRef.current = [];

          if (audioBlob.size === 0) {
            resolve("");
            return;
          }

          // Upload to backend for transcription
          try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');

            const response = await fetch(
              `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/api/llm/transcribe-audio/`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Token ${token}`,
                  // Do NOT set Content-Type - let browser set it with boundary
                },
                body: formData,
              }
            );

            if (response.status === 400) {
              // Language validation error
              const errorData = await response.json();
              const errorMessage = errorData.detail || "I can understand English only";
              reject(new Error(errorMessage));
              return;
            }

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              const errorMessage = errorData.detail || "Failed to transcribe audio";
              reject(new Error(errorMessage));
              return;
            }

            const data = await response.json();
            const transcribedText = data.text || "";
            resolve(transcribedText);
          } catch (err: any) {
            console.error("[startListening] Transcription error:", err);
            reject(err);
          }
        };

        // Start recording
        setStatus("listening");
        mediaRecorder.start();
      } catch (err: any) {
        console.error("[startListening] Setup error:", err);
        reject(new Error("Failed to access microphone"));
      }
    });
  };

  // 🚀 COMBINED ENDPOINT: Records audio AND gets next question in ONE request
  const startListeningAndProcessing = (
    cvId: number,
    paperId: number,
    history: any[],
    currentSection: string
  ): Promise<{ transcription: string; question_data: any }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyserRef.current = analyser;
        analyser.fftSize = 256;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const SILENCE_THRESHOLD = 0.03;
        const SILENCE_DURATION_MS = 2000;
        let lastSoundTime = Date.now();

        const checkVolume = () => {
          if (!analyserRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / bufferLength;
          const volume = average / 255;
          if (volume > SILENCE_THRESHOLD) {
            lastSoundTime = Date.now();
          } else if (Date.now() - lastSoundTime >= SILENCE_DURATION_MS) {
            setStatus("thinking"); // Show "thinking" immediately when silence detected
            stopListening();
          }
        };

        volumeCheckIntervalRef.current = setInterval(checkVolume, 100);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          if (volumeCheckIntervalRef.current) clearInterval(volumeCheckIntervalRef.current);

          // Fix: Check if AudioContext is already closed before trying to close it
          if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            try {
              audioContextRef.current.close();
            } catch (err) {
              console.error("[startListeningAndProcessing] Error closing AudioContext:", err);
            }
          }
          audioContextRef.current = null;

          stream.getTracks().forEach(track => track.stop());

          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (audioBlob.size === 0) {
            resolve({ transcription: "", question_data: null });
            return;
          }

          try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('cv_id', String(cvId));
            formData.append('paper_id', String(paperId));
            formData.append('history', JSON.stringify(history));
            formData.append('section', currentSection);

            const response = await fetch(
              `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/api/llm/voice-to-question/`,
              {
                method: 'POST',
                headers: { Authorization: `Token ${token}` },
                body: formData,
              }
            );

            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(errData.detail || "Processing failed");
            }

            resolve(await response.json());
          } catch (err: any) {
            reject(err);
          }
        };

        setStatus("listening");
        mediaRecorder.start();
      } catch (err: any) {
        reject(new Error("Failed to access microphone"));
      }
    });
  };


  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.error("[stopListening] Error stopping recorder:", err);
      }
    }
    if (volumeCheckIntervalRef.current) {
      clearInterval(volumeCheckIntervalRef.current);
      volumeCheckIntervalRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  };

  const fetchNextQuestion = async (
    currentSection: SectionKey,
  ): Promise<{ question: string; nextSection: string; completeSection: boolean; done: boolean }> => {
    if (!token) {
      throw new Error("Missing auth token.");
    }

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/api/llm/recruiter-assistant/question/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          cv_id: cvId,
          paper_id: paperId,
          history: historyRef.current,
          section: currentSection,
        }),
      },
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = (data as any)?.detail || "Failed to generate next question.";
      throw new Error(detail);
    }

    const data = (await res.json()) as {
      question: string;
      section: string;
      complete_section: boolean;
      done: boolean;
    };

    return {
      question: data.question,
      nextSection: data.section,
      completeSection: data.complete_section,
      done: data.done,
    };
  };

  const runConversation = async () => {
    if (cancelledRef.current) return;
    setError(null);
    setStatus("thinking");

    try {
      if (!token) {
        throw new Error("Missing auth token.");
      }

      // Ensure we have a conversation session (Phase 0)
      const startRes = await startConversationSession(token, cvId, paperId);
      setSessionId(startRes.session_id);
      sessionIdRef.current = startRes.session_id;

      let currentSection: SectionKey = "core_skills";
      setSection(currentSection);
      let done = false;

      // Phase 1: Get initial question
      setStatus("thinking");
      const { question: initialQuestion, nextSection: initialNextSection, done: initialDone } = await fetchNextQuestion(currentSection);

      if (initialNextSection && initialNextSection !== currentSection) {
        currentSection = initialNextSection as SectionKey;
        setSection(currentSection);
      }

      if (!initialQuestion || initialDone) {
        done = true;
      }

      let question = initialQuestion;

      // Phase 2: Main loop using SUPER ENDPOINT (transcription + question in ONE request)
      while (!done && !cancelledRef.current) {
        let result;

        try {
          // Speak the question first
          historyRef.current.push({ role: "assistant", content: question });
          await speak(question);
          if (cancelledRef.current) break;

          // 🚀 Combined transcription + question generation
          // Clear previous transcript right when we start listening again (so the last answer
          // remains visible during "Speaking" / "Thinking" states).
          setLastTranscript("");
          result = await startListeningAndProcessing(cvId, paperId, historyRef.current, currentSection);

          //console.log("[DEBUG] Result from combined endpoint:", result);
          //console.log("[DEBUG] Transcription:", result?.transcription);

          // Show transcription immediately when we get the response
          if (result?.transcription) {
            //console.log("[DEBUG] Setting transcript to:", result.transcription);
            setLastTranscript(result.transcription);
          } else {
            //console.log("[DEBUG] No transcription in result!");
          }
        } catch (err: any) {
          const errorMessage = err?.message || "Voice input error.";

          // ✅ If user clicked "End Session", exit gracefully without error
          if (errorMessage.includes("Session ended by user")) {
            break;
          }

          if (errorMessage.toLowerCase().includes("english")) {
            await speak(errorMessage);
            await new Promise(r => setTimeout(r, 500));
            await speak(question); // Repeat last question
            continue;
          }
          setError(errorMessage);
          break;
        }

        const { transcription: answer, question_data: nextQData } = result;

        if (!answer || !answer.trim()) {
          await new Promise(r => setTimeout(r, 500));
          await speak(question); // Repeat last question
          continue;
        }

        historyRef.current.push({ role: "recruiter", content: answer });

        // Save to database asynchronously (non-blocking)
        const currentSessionId = sessionIdRef.current || sessionId;
        if (currentSessionId) {
          const phase = currentSection === "additional_info" ? "discovery" : "validation";
          createConversationTurn(token, {
            session_id: currentSessionId,
            section: currentSection,
            phase: phase,
            question_text: question,
            answer_text: answer,
          }).catch((err: any) => {
            console.error("[Frontend] ❌ Failed to store conversation turn:", err);
          });
        }

        // Process next question data
        if (!nextQData) {
          done = true;
          break;
        }

        const nextQuestion = nextQData.question || "";
        const nextSection = nextQData.section || currentSection;
        const isDone = nextQData.done || false;

        // Update section if changed
        if (nextSection && nextSection !== currentSection) {
          currentSection = nextSection as SectionKey;
          setSection(currentSection);
        }

        // Check if this is the final turn
        const hasQuestionMark = nextQuestion.includes("?");
        const isAdditionalInfoFinalPrompt =
          currentSection === "additional_info" &&
          isDone &&
          hasQuestionMark &&
          /\b(anything else|add anything|add more|else we haven't covered)\b/i.test(nextQuestion);

        if (isDone && !isAdditionalInfoFinalPrompt) {
          // Final outro - speak and exit
          if (nextQuestion) {
            historyRef.current.push({ role: "assistant", content: nextQuestion });
            await speak(nextQuestion);
          }
          done = true;
          break;
        }

        // Continue with next question
        question = nextQuestion;
      }

      // Generate final competence paper: show "Generating" for at least 2s, then final screen
      if (!cancelledRef.current) {
        setIsGeneratingPaper(true);
        setStatus("generating");
        const generatingStart = Date.now();
        try {
          const finalSessionId = sessionIdRef.current || sessionId;
          if (finalSessionId) {
            const paperResult = await generateConversationCompetencePaper(token, finalSessionId);
            setHasGeneratedPaper(true);
            setGeneratedPaperId(paperResult?.id ?? null);
          }
          const elapsed = Date.now() - generatingStart;
          if (elapsed < 2000) {
            await new Promise((r) => setTimeout(r, 2000 - elapsed));
          }
          setStatus("finished");
        } catch (err: any) {
          console.error("[Frontend] ❌ Failed to generate competence paper:", err);
          setError("Failed to generate competence paper.");
          const elapsed = Date.now() - generatingStart;
          if (elapsed < 2000) {
            await new Promise((r) => setTimeout(r, 2000 - elapsed));
          }
          setStatus("finished");
        } finally {
          setIsGeneratingPaper(false);
        }
      }
    } catch (err: any) {
      console.error("[Frontend] ❌ Conversation error:", err);
      if (!cancelledRef.current) {
        setError(err?.message || "An error occurred during the conversation.");
        setStatus("finished");
      }
    }
  };

  useEffect(() => {
    cancelledRef.current = false;

    if (isOpen) {
      historyRef.current = [];
      setSessionId(null);
      setHasGeneratedPaper(false);
      setIsGeneratingPaper(false);
      setSection("core_skills");
      runConversation();
    } else {
      cancelledRef.current = true;
      stopListening();
      setStatus("idle");
      setError(null);
      setHasGeneratedPaper(false);
      setGeneratedPaperId(null);
      setIsGeneratingPaper(false);
      setSessionId(null);
      sessionIdRef.current = null; // Clear ref as well
      historyRef.current = [];
    }

    return () => {
      cancelledRef.current = true;
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleEnd = () => {
    cancelledRef.current = true;

    // Stop any currently playing audio IMMEDIATELY
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }

    // Stop listening/recording
    stopListening();

    // Force stop MediaRecorder if still active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      } catch (err) {
        console.error("[handleEnd] Error stopping MediaRecorder:", err);
      }
    }

    // Close AudioContext if active
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
        audioContextRef.current = null;
      } catch (err) {
        console.error("[handleEnd] Error closing AudioContext:", err);
      }
    }

    // Clear all intervals and timeouts
    if (volumeCheckIntervalRef.current) {
      clearInterval(volumeCheckIntervalRef.current);
      volumeCheckIntervalRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    setStatus("finished");
    onClose();
  };

  if (!isOpen) return null;

  const sectionLabel: string = (() => {
    switch (section) {
      case "core_skills":
        return "Core Skills";
      case "soft_skills":
        return "Soft Skills";
      case "languages":
        return "Languages";
      case "education":
        return "Education";
      case "trainings_certifications":
        return "Trainings & Certifications";
      case "technical_competencies":
        return "Technical Competencies";
      case "project_experience":
        return "Project Experience";
      case "recommendations":
        return "Recommendations";
      case "additional_info":
        return "Additional Information";
      default:
        return "";
    }
  })();

  const statusLabel: string = (() => {
    switch (status) {
      case "speaking":
        return "Speaking";
      case "listening":
        return "Listening";
      case "thinking":
        return "Thinking";
      case "generating":
        return "Generating";
      case "completed":
        return "Completed";
      case "finished":
        return "Done";
      case "error":
        return "Error";
      default:
        return "Idle";
    }
  })();

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 backdrop-blur-md px-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800/70 bg-gradient-to-b from-slate-950/95 to-slate-950/90 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 10v2a7 7 0 01-14 0v-2M12 17v4m0 0H9m3 0h3" />
              </svg>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-emerald-300/80">Recruiter Voice Assistant</p>
              <h2 className="text-lg font-semibold text-slate-100">Interview Verification</h2>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                <span className="rounded-full bg-slate-800/70 px-2 py-0.5 text-slate-300">
                  {status === "finished" ? "Section: Complete" : `Section: ${sectionLabel}`}
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>
          {status !== "finished" && (
            <button
              onClick={handleEnd}
              disabled={isGeneratingPaper}
              className="rounded-lg bg-red-500/90 hover:bg-red-600 text-xs font-semibold text-white px-3 py-2 shadow-lg shadow-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              End Session
            </button>
          )}
        </div>

        {/* 1. Generating: professional screen (min 2s), then final screen */}
        {(status === "generating" || isGeneratingPaper) && (
          <div className="mt-6 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-8 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-400/20 px-3 py-1.5 mb-4">
              <span className="text-xs font-medium text-emerald-300">Preparing your report</span>
            </div>
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400/40 flex items-center justify-center mb-4">
              <div className="h-8 w-8 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />
            </div>
            <h3 className="text-xl font-bold text-slate-100 mb-2">Generating competence paper</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Your answers are being processed. This will only take a moment.
            </p>
          </div>
        )}

        {/* 2. Finished: single final screen — section completed, only Open paper (to conversation-competence-summaries) */}
        {status === "finished" && (
          <div className="mt-6 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-8 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-400/20 px-3 py-1.5 mb-4">
              <span className="text-xs font-medium text-emerald-300">All sections completed</span>
            </div>
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400/40 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-slate-100 mb-2">Interview complete</h3>
            <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
              Verification interview finished. Your answers have been recorded and the competence paper has been generated.
            </p>
            {error && (
              <p className="text-sm text-red-300 mb-4">{error}</p>
            )}
            <a
              href="/dashboard/conversation-competence-summaries"
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-sm font-semibold text-slate-950 px-6 py-3 shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02]"
            >
              Open paper
            </a>
          </div>
        )}

        {/* 3. Live session: listening, speaking, thinking */}
        {status !== "finished" && status !== "generating" && !isGeneratingPaper && (
          <div className="mt-6 rounded-xl border border-slate-800/60 bg-slate-950/60 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center">
                    <div className="h-8 w-8 rounded-full bg-emerald-400/90" />
                  </div>
                  {(status === "speaking" || status === "listening") && (
                    <span className="absolute -inset-1 rounded-full border border-emerald-400/30 animate-ping" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-slate-200 font-medium">Live Session</p>
                  <p className="text-xs text-slate-400">Audio I/O is active while listening or speaking.</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <span
                    key={idx}
                    className={`h-6 w-1.5 rounded-full ${status === "speaking" || status === "listening"
                      ? "bg-emerald-400/90 animate-pulse"
                      : "bg-slate-700/70"
                      }`}
                    style={{ animationDelay: `${idx * 120}ms` }}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            {lastTranscript && (
              <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                <p className="text-xs font-semibold text-emerald-300/80 mb-1">You said:</p>
                <p className="text-sm text-slate-200 italic">"{lastTranscript}"</p>
              </div>
            )}
          </div>
        )}

        {/* <div className="mt-6 flex justify-end gap-2 border-t border-slate-800/60 pt-4">
          <button
            onClick={handleEnd}
            disabled={isGeneratingPaper}
            className="rounded-lg border border-slate-700/70 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900/70 hover:border-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Close
          </button>
        </div> */}
      </div>
    </div>
  );
}



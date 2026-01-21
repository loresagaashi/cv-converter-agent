"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";

type SectionKey = "core_skills" | "professional_experience" | "training_certifications";

interface HistoryItem {
  role: "assistant" | "recruiter";
  content: string;
}

interface RecruiterVoiceAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  cvId: number;
  paperId: number;
  cvFilename?: string;
}

type StatusState = "idle" | "speaking" | "listening" | "thinking" | "finished" | "error";

/**
 * Voice-only recruiter assistant UI.
 *
 * - No text transcript of the conversation is shown.
 * - Uses browser speech synthesis / recognition for audio I/O.
 * - Uses backend /api/llm/recruiter-assistant/question/ (gpt-4o-mini) for reasoning.
 */
export function RecruiterVoiceAssistant({
  isOpen,
  onClose,
  cvId,
  paperId,
  cvFilename,
}: RecruiterVoiceAssistantProps) {
  const { token } = useAuth();

  const [status, setStatus] = useState<StatusState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("core_skills");

  const historyRef = useRef<HistoryItem[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const cancelledRef = useRef(false);

  const getSpeechSynthesis = () => {
    if (typeof window === "undefined") return null;
    return window.speechSynthesis || null;
  };

  const getSpeechRecognition = (): SpeechRecognition | null => {
    if (typeof window === "undefined") return null;
    const AnyWindow = window as any;
    const SR = AnyWindow.SpeechRecognition || AnyWindow.webkitSpeechRecognition;
    if (!SR) return null;
    return new SR();
  };

  const speak = (text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const synth = getSpeechSynthesis();
      if (!synth) {
        reject(new Error("Speech synthesis not supported in this browser."));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      setStatus("speaking");

      utterance.onend = () => {
        resolve();
      };
      utterance.onerror = () => {
        reject(new Error("Speech synthesis error"));
      };

      synth.speak(utterance);
    });
  };

  const startListening = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const recognition = getSpeechRecognition();
      if (!recognition) {
        reject(new Error("Speech recognition not supported in this browser."));
        return;
      }

      recognitionRef.current = recognition;
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      let finalTranscript = "";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const result = event.results[0];
        if (result && result[0]) {
          finalTranscript = result[0].transcript.trim();
        }
      };

      recognition.onerror = () => {
        recognition.stop();
        reject(new Error("Speech recognition error"));
      };

      recognition.onend = () => {
        resolve(finalTranscript);
      };

      setStatus("listening");
      recognition.start();
    });
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  };

  const fetchNextQuestion = async (
    currentSection: SectionKey,
  ): Promise<{ question: string; nextSection: SectionKey; completeSection: boolean; done: boolean }> => {
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
      section: SectionKey;
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
      const namePart = cvFilename ? ` for ${cvFilename}` : "";
      await speak(
        `Hello, I am an AI recruiter assistant. I will help you verify the information in this CV${namePart}. We will go section by section, starting with core skills.`,
      );

      let currentSection: SectionKey = "core_skills";
      let done = false;

      while (!done && !cancelledRef.current) {
        setStatus("thinking");
        const { question, nextSection, completeSection, done: isDone } = await fetchNextQuestion(currentSection);

        if (!question) {
          done = true;
          break;
        }

        historyRef.current.push({ role: "assistant", content: question });
        await speak(question);
        if (cancelledRef.current) break;

        let answer = "";
        try {
          answer = await startListening();
        } catch (err: any) {
          setError(err?.message || "Voice input error.");
        } finally {
          stopListening();
        }

        if (cancelledRef.current) break;

        if (answer) {
          historyRef.current.push({ role: "recruiter", content: answer });
        }

        if (completeSection) {
          currentSection = nextSection;
          setSection(nextSection);
        }

        done = isDone;
      }

      if (!cancelledRef.current) {
        setStatus("finished");
        await speak("Thank you. The verification conversation for this CV is now complete.");
      }
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Unexpected error during conversation.");
    } finally {
      stopListening();
    }
  };

  useEffect(() => {
    cancelledRef.current = false;

    if (isOpen) {
      historyRef.current = [];
      setSection("core_skills");
      runConversation();
    } else {
      cancelledRef.current = true;
      stopListening();
      const synth = getSpeechSynthesis();
      if (synth && synth.speaking) {
        synth.cancel();
      }
      setStatus("idle");
      setError(null);
      historyRef.current = [];
    }

    return () => {
      cancelledRef.current = true;
      stopListening();
      const synth = getSpeechSynthesis();
      if (synth && synth.speaking) {
        synth.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleEnd = () => {
    cancelledRef.current = true;
    stopListening();
    const synth = getSpeechSynthesis();
    if (synth && synth.speaking) {
      synth.cancel();
    }
    setStatus("finished");
    onClose();
  };

  if (!isOpen) return null;

  const sectionLabel: string = (() => {
    switch (section) {
      case "core_skills":
        return "Core Skills";
      case "professional_experience":
        return "Professional Experience";
      case "training_certifications":
        return "Training & Certifications";
      default:
        return "";
    }
  })();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">
              Voice-only recruiter assistant •{" "}
              <span className="font-semibold text-emerald-300">{sectionLabel}</span>
            </p>
          </div>
          <button
            onClick={handleEnd}
            className="rounded-full bg-red-500/90 hover:bg-red-600 text-xs font-semibold text-white px-3 py-1.5 shadow-lg shadow-red-500/30 transition-colors"
          >
            End
          </button>
        </div>

        <div className="flex flex-col items-center justify-center py-6 gap-3">
          <div className="relative">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center">
              <span className="w-7 h-7 rounded-full bg-emerald-400/90 text-slate-950 flex items-center justify-center">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M19 10v2a7 7 0 01-14 0v-2M12 17v4m0 0H9m3 0h3"
                  />
                </svg>
              </span>
            </div>
            {(status === "speaking" || status === "listening") && (
              <span className="absolute -inset-1 rounded-full border border-emerald-400/40 animate-ping" />
            )}
          </div>
          {error && <p className="text-xs text-red-300 text-center">{error}</p>}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={handleEnd}
            className="rounded-lg border border-slate-700/60 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-900/70 hover:border-slate-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}



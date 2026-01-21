"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { createConversationTurn, generateConversationCompetencePaper, startConversationSession } from "@/lib/api";

// Fallback typings for browser speech recognition APIs to satisfy TypeScript
// in environments where lib.dom.d.ts does not declare them.
type BrowserSpeechRecognition = any;

type SectionKey =
  | "core_skills"
  | "soft_skills"
  | "languages"
  | "education"
  | "trainings_certifications"
  | "technical_competencies"
  | "project_experience"
  | "overall";

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

const SECTION_ORDER: SectionKey[] = [
  "core_skills",
  "soft_skills",
  "languages",
  "education",
  "trainings_certifications",
  "technical_competencies",
  "project_experience",
  "overall",
];

const MAX_QUESTIONS_PER_SECTION: Record<SectionKey, number> = {
  core_skills: 5,
  soft_skills: 2,
  languages: 3,
  education: 2,
  trainings_certifications: 2,
  technical_competencies: 5,
  project_experience: 4,
  overall: 3,
};

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
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isGeneratingPaper, setIsGeneratingPaper] = useState(false);
  const [hasGeneratedPaper, setHasGeneratedPaper] = useState(false);

  const historyRef = useRef<HistoryItem[]>([]);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const cancelledRef = useRef(false);
  const sectionQuestionCountRef = useRef<Record<SectionKey, number>>({
    core_skills: 0,
    soft_skills: 0,
    languages: 0,
    education: 0,
    trainings_certifications: 0,
    technical_competencies: 0,
    project_experience: 0,
    overall: 0,
  });

  const getSpeechSynthesis = () => {
    if (typeof window === "undefined") return null;
    return window.speechSynthesis || null;
  };

  const getSpeechRecognition = (): BrowserSpeechRecognition | null => {
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
      let finished = false;

      recognition.onresult = (event: any) => {
        if (!event || !event.results) return;
        for (let i = event.resultIndex || 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result && result.isFinal && result[0]) {
            finalTranscript = String(result[0].transcript || "").trim();
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (finished) return;
        finished = true;
        try {
          recognition.stop();
        } catch {
          // ignore
        }

        const errType = (event && event.error) || "";
        // Treat "no-speech", "no-match", or "aborted" as soft errors: just return whatever we have.
        if (errType === "no-speech" || errType === "no-match" || errType === "aborted") {
          resolve(finalTranscript);
          return;
        }

        reject(new Error(errType || "Speech recognition error"));
      };

      recognition.onend = () => {
        if (finished) return;
        finished = true;
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
      if (!token) {
        throw new Error("Missing auth token.");
      }

      // Ensure we have a conversation session (Phase 0)
      const startRes = await startConversationSession(token, cvId, paperId);
      setSessionId(startRes.session_id);

      const namePart = cvFilename ? ` for ${cvFilename}` : "";
      await speak(
        `Hello, I am an AI recruiter assistant. I will help you verify the information in this CV${namePart}. We will go section by section, starting with core skills.`,
      );

      let currentSection: SectionKey = "core_skills";
      let done = false;

      // Phase 1: 7 main sections driven by backend question generator
      while (!done && !cancelledRef.current) {
        setStatus("thinking");
        const { question, nextSection, completeSection, done: isDone } = await fetchNextQuestion(currentSection);

        if (!question) {
          done = true;
          break;
        }

        // Track how many questions we have asked in this section.
        sectionQuestionCountRef.current[currentSection] =
          (sectionQuestionCountRef.current[currentSection] || 0) + 1;

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

          // Store this turn in backend (Phase 1 - validation)
          if (sessionId) {
            try {
              await createConversationTurn(token, {
                session_id: sessionId,
                section: currentSection,
                phase: "validation",
                question_text: question,
                answer_text: answer,
              });
            } catch (err: any) {
              // Non-fatal; continue conversation but surface error.
              setError(err?.message || "Failed to store conversation turn.");
            }
          }
        }

        // Apply frontend guard-rails to avoid loops in a section:
        // if the model does not mark the section complete but we have already
        // asked our configured maximum number of questions, force completion
        // and move to the next section in the fixed order.
        let effectiveCompleteSection = completeSection;
        let effectiveNextSection = nextSection;
        let effectiveDone = isDone;

        if (
          !completeSection &&
          sectionQuestionCountRef.current[currentSection] >= MAX_QUESTIONS_PER_SECTION[currentSection]
        ) {
          effectiveCompleteSection = true;

          const idx = SECTION_ORDER.indexOf(currentSection);
          if (idx >= 0 && idx < SECTION_ORDER.length - 1) {
            effectiveNextSection = SECTION_ORDER[idx + 1];
          } else {
            effectiveNextSection = currentSection;
          }
        }

        if (effectiveCompleteSection) {
          currentSection = effectiveNextSection;
          setSection(effectiveNextSection);
        }

        done = effectiveDone;
      }

      // Phase 2: Additional information collection (overall)
      if (!cancelledRef.current && !done) {
        let additionalDone = false;
        while (!additionalDone && !cancelledRef.current) {
          const additionalQuestion =
            "Do you have any additional information about the candidate from the interview that's not in the CV?";

          historyRef.current.push({ role: "assistant", content: additionalQuestion });
          await speak(additionalQuestion);
          if (cancelledRef.current) break;

          let extraAnswer = "";
          try {
            extraAnswer = await startListening();
          } catch (err: any) {
            setError(err?.message || "Voice input error.");
          } finally {
            stopListening();
          }

          if (cancelledRef.current) break;

          extraAnswer = extraAnswer.trim();
          if (extraAnswer) {
            historyRef.current.push({ role: "recruiter", content: extraAnswer });

            // Store discovery turn in backend
            if (sessionId) {
              try {
                await createConversationTurn(token, {
                  session_id: sessionId,
                  section: "overall",
                  phase: "discovery",
                  question_text: additionalQuestion,
                  answer_text: extraAnswer,
                });
              } catch (err: any) {
                setError(err?.message || "Failed to store additional information.");
              }
            }

            const lower = extraAnswer.toLowerCase();
            if (
              lower === "no" ||
              lower === "nope" ||
              lower.includes("nothing else") ||
              lower.includes("that's all") ||
              lower.includes("that is all")
            ) {
              additionalDone = true;
              break;
            }
          } else {
            // Empty answer, ask again once.
            additionalDone = true;
          }
        }
      }

      // Phase 3: Generate competence paper
      if (!cancelledRef.current && sessionId && !hasGeneratedPaper) {
        try {
          setIsGeneratingPaper(true);
          await generateConversationCompetencePaper(token, sessionId);
          setHasGeneratedPaper(true);
        } catch (err: any) {
          setError(err?.message || "Failed to generate conversation competence paper.");
        } finally {
          setIsGeneratingPaper(false);
        }
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
      setSessionId(null);
      setHasGeneratedPaper(false);
      setIsGeneratingPaper(false);
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
      case "overall":
        return "Additional Information";
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
          {error && <p className="text-xs text-red-300 text-center px-4">{error}</p>}
          {isGeneratingPaper && (
            <p className="text-xs text-emerald-300 text-center px-4">
              Generating conversation-based competence paper...
            </p>
          )}
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



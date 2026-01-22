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
  cvFilename?: string;
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
  additional_info: 10, // Allow more questions for additional info collection
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
  const [generatedPaperId, setGeneratedPaperId] = useState<number | null>(null);

  const historyRef = useRef<HistoryItem[]>([]);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const cancelledRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null); // Use ref to always have latest sessionId
  const sectionQuestionCountRef = useRef<Record<SectionKey, number>>({
    core_skills: 0,
    soft_skills: 0,
    languages: 0,
    education: 0,
    trainings_certifications: 0,
    technical_competencies: 0,
    project_experience: 0,
    additional_info: 0,
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

  // Select the best available voice (prefer natural-sounding voices)
  const getBestVoice = (): SpeechSynthesisVoice | null => {
    const synth = getSpeechSynthesis();
    if (!synth) return null;

    const voices = synth.getVoices();
    if (voices.length === 0) return null;

    // Priority order: Google Neural voices > Google voices > Microsoft voices > others
    // Prefer female voices as they often sound more natural
    const preferredNames = [
      // Google Neural voices (best quality)
      "Google UK English Female",
      "Google US English Female",
      "Google UK English Male",
      "Google US English Male",
      // Google standard voices
      "Google UK English",
      "Google US English",
      // Microsoft voices
      "Microsoft Zira - English (United States)",
      "Microsoft Hazel - English (Great Britain)",
      "Microsoft Susan - English (United States)",
      // Other natural voices
      "Samantha",
      "Victoria",
      "Alex",
      "Karen",
      "Fiona",
    ];

    // Try to find a preferred voice
    for (const name of preferredNames) {
      const voice = voices.find((v) => v.name.includes(name));
      if (voice) return voice;
    }

    // Fallback: find any English voice that's not obviously robotic
    const englishVoice = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        !v.name.toLowerCase().includes("robotic") &&
        !v.name.toLowerCase().includes("novox")
    );
    if (englishVoice) return englishVoice;

    // Last resort: return first available voice
    return voices[0];
  };

  const speak = (text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const synth = getSpeechSynthesis();
      if (!synth) {
        reject(new Error("Speech synthesis not supported in this browser."));
        return;
      }

      // Wait for voices to load if needed (Chrome requires this)
      if (synth.getVoices().length === 0) {
        synth.onvoiceschanged = () => {
          const utterance = createUtterance(text, synth);
          setStatus("speaking");
          utterance.onend = () => resolve();
          utterance.onerror = () => reject(new Error("Speech synthesis error"));
          synth.speak(utterance);
        };
        // Trigger voices to load
        synth.getVoices();
      } else {
        const utterance = createUtterance(text, synth);
        setStatus("speaking");
        utterance.onend = () => resolve();
        utterance.onerror = () => reject(new Error("Speech synthesis error"));
        synth.speak(utterance);
      }
    });
  };

  const createUtterance = (
    text: string,
    synth: SpeechSynthesis
  ): SpeechSynthesisUtterance => {
    const utterance = new SpeechSynthesisUtterance(text);

    // Select best voice
    const voice = getBestVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      // Fallback to default
      utterance.lang = "en-US";
    }

    // Add emotions and natural variations based on content
    const textLower = text.toLowerCase();
    
    // Adjust pitch for different emotions (more variation for expressiveness)
    let basePitch = 1.0;
    if (textLower.includes('great') || textLower.includes('perfect') || textLower.includes('got it') || 
        textLower.includes('thanks') || textLower.includes('excellent') || textLower.includes('awesome')) {
      basePitch = 1.15; // Higher for positive/excited responses
    } else if (textLower.includes('sorry') || textLower.includes("didn't") || textLower.includes("didn't catch") || 
               textLower.includes('clarify') || textLower.includes("didn't get")) {
      basePitch = 0.9; // Lower for apologies/clarifications (more empathetic)
    } else if (textLower.includes('!') || textLower.includes('hi') || textLower.includes('hello')) {
      basePitch = 1.12; // Higher for exclamations and greetings
    } else if (textLower.includes('?') && (textLower.includes('anything else') || textLower.includes('anything more'))) {
      basePitch = 1.05; // Slightly higher for follow-up questions
    }
    
    // Adjust rate for natural speech (more variation)
    let baseRate = 1.0;
    if (text.length < 30) {
      baseRate = 0.92; // Slower for very short phrases (more emphasis)
    } else if (text.length < 60) {
      baseRate = 0.96; // Slightly slower for short phrases
    } else if (text.length > 150) {
      baseRate = 1.08; // Faster for longer sentences
    }
    
    // Add more variation for naturalness and emotion
    const pitchVariation = 0.05; // More variation for expressiveness
    const rateVariation = 0.04;
    
    utterance.rate = Math.max(0.8, Math.min(1.2, baseRate + (Math.random() * rateVariation - rateVariation / 2)));
    utterance.pitch = Math.max(0.8, Math.min(1.3, basePitch + (Math.random() * pitchVariation - pitchVariation / 2)));
    utterance.volume = 1.0; // Full volume (0 to 1, default 1)

    return utterance;
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
      console.log(`[Frontend] 🚀 Starting conversation session: cvId=${cvId}, paperId=${paperId}`);
      const startRes = await startConversationSession(token, cvId, paperId);
      console.log(`[Frontend] ✅ Session created/retrieved: session_id=${startRes.session_id}, status=${startRes.status}`);
      setSessionId(startRes.session_id);
      sessionIdRef.current = startRes.session_id; // Also store in ref for immediate access

      const namePart = cvFilename ? ` for ${cvFilename}` : "";
      await speak(
        `Hello, I am an AI recruiter assistant. I will help you verify the information in this CV${namePart}. We will go section by section, starting with core skills.`,
      );

      let currentSection: SectionKey = "core_skills";
      setSection(currentSection); // Set initial section
      let done = false;
      let allSectionsComplete = false;

      // Phase 1: 7 main sections driven by backend question generator
      while (!done && !cancelledRef.current) {
        setStatus("thinking");
        console.log(`[Frontend] 🔄 Fetching next question for section: ${currentSection}`);
        const { question, nextSection, completeSection, done: isDone } = await fetchNextQuestion(currentSection);
        
        console.log(
          `[Frontend] 📥 Received from backend: section=${nextSection}, complete_section=${completeSection}, done=${isDone}, question="${question?.substring(0, 50)}..."`
        );

        // Update section immediately from backend response
        if (nextSection && nextSection !== currentSection) {
          console.log(`[Frontend] 🔀 Section changed: ${currentSection} → ${nextSection}`);
          currentSection = nextSection as SectionKey;
          setSection(currentSection);
        }

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
          console.log(`[Frontend] 🎤 Starting to listen for answer...`);
          setStatus("listening");
          answer = await startListening();
          console.log(`[Frontend] ✅ Received answer: "${answer}"`);
        } catch (err: any) {
          console.error(`[Frontend] ❌ Error listening:`, err);
          setError(err?.message || "Voice input error.");
        } finally {
          stopListening();
        }

        if (cancelledRef.current) break;

        if (answer) {
          historyRef.current.push({ role: "recruiter", content: answer });
          console.log(`[Frontend] 📝 Added answer to history. Total history items: ${historyRef.current.length}`);

          // Store this turn in backend
          // Phase 1: validation for main sections, Phase 2: discovery for additional_info
          // Use ref to get the latest sessionId (React state updates are async)
          const currentSessionId = sessionIdRef.current || sessionId;
          
          if (!currentSessionId) {
            console.error("[Frontend] ❌ Cannot store conversation turn: sessionId is null");
            console.error("[Frontend] Attempting to re-create session...");
            try {
              const startRes = await startConversationSession(token, cvId, paperId);
              console.log(`[Frontend] ✅ Re-created session: session_id=${startRes.session_id}`);
              setSessionId(startRes.session_id);
              sessionIdRef.current = startRes.session_id;
              
              // Retry storing the turn with the new session
              const phase = currentSection === "additional_info" ? "discovery" : "validation";
              const result = await createConversationTurn(token, {
                session_id: startRes.session_id,
                section: currentSection,
                phase: phase,
                question_text: question,
                answer_text: answer,
              });
              console.log(
                `[Frontend] ✅ Successfully stored after re-creating session: question_id=${result.question_id}, response_id=${result.response_id}`
              );
            } catch (err: any) {
              console.error("[Frontend] ❌ Failed to re-create session:", err);
              setError("Failed to create conversation session. Please try again.");
            }
          } else {
            try {
              const phase = currentSection === "additional_info" ? "discovery" : "validation";
              console.log(
                `[Frontend] 💾 Storing conversation turn: session_id=${currentSessionId}, section=${currentSection}, phase=${phase}`
              );
              console.log(`[Frontend] Question: ${question.substring(0, 50)}...`);
              console.log(`[Frontend] Answer: ${answer.substring(0, 50)}...`);
              
              const result = await createConversationTurn(token, {
                session_id: currentSessionId,
                section: currentSection, // Use current section from backend
                phase: phase,
                question_text: question,
                answer_text: answer,
              });
              
              console.log(
                `[Frontend] ✅ Successfully stored: question_id=${result.question_id}, response_id=${result.response_id}, status=${result.status}`
              );
            } catch (err: any) {
              // Non-fatal; continue conversation but surface error.
              console.error("[Frontend] ❌ Failed to store conversation turn:", err);
              console.error("[Frontend] Error details:", err?.message, err?.response);
              // Try to get more details from the error
              if (err?.status === 404) {
                console.error("[Frontend] Session not found. Attempting to re-create...");
                try {
                  const startRes = await startConversationSession(token, cvId, paperId);
                  console.log(`[Frontend] ✅ Re-created session: session_id=${startRes.session_id}`);
                  setSessionId(startRes.session_id);
                  sessionIdRef.current = startRes.session_id;
                } catch (recreateErr: any) {
                  console.error("[Frontend] ❌ Failed to re-create session:", recreateErr);
                }
              }
              setError(err?.message || "Failed to store conversation turn.");
            }
          }
        }

        // Apply frontend guard-rails to avoid loops in a section:
        // if the model does not mark the section complete but we have already
        // asked our configured maximum number of questions, force completion
        // and move to the next section in the fixed order.
        let effectiveCompleteSection = completeSection;
        let effectiveNextSection = nextSection as SectionKey;
        let effectiveDone = isDone;

        if (
          !completeSection &&
          sectionQuestionCountRef.current[currentSection] >= MAX_QUESTIONS_PER_SECTION[currentSection]
        ) {
          effectiveCompleteSection = true;

          const idx = SECTION_ORDER.indexOf(currentSection);
          if (idx >= 0 && idx < SECTION_ORDER.length - 1) {
            effectiveNextSection = SECTION_ORDER[idx + 1] as SectionKey;
          } else {
            effectiveNextSection = currentSection;
          }
        }

        if (effectiveCompleteSection) {
          currentSection = effectiveNextSection;
          setSection(effectiveNextSection);
          
          // Check if all 7 main sections are complete (before additional_info)
          const mainSections = SECTION_ORDER.slice(0, 7); // First 7 sections
          if (effectiveNextSection === "additional_info") {
            allSectionsComplete = true;
          }
        }

        done = effectiveDone;
        
        console.log(
          `[Frontend] 📊 Loop state: currentSection=${currentSection}, done=${done}, ` +
          `completeSection=${effectiveCompleteSection}, allSectionsComplete=${allSectionsComplete}`
        );
        
        // If done is true, all sections including additional_info are complete
        if (done) {
          allSectionsComplete = true;
          console.log(`[Frontend] ✅ Conversation complete! All sections done.`);
        }
      }
      
      console.log(`[Frontend] 🏁 Exited main loop. done=${done}, allSectionsComplete=${allSectionsComplete}`);

      // Phase 2 is handled automatically by the backend - it will move to additional_info
      // section after all 7 main sections are complete. The main loop above handles it.

      // Phase 3: Generate competence paper (after all phases complete - when done=true)
      const finalSessionId = sessionIdRef.current || sessionId;
      console.log(
        `[Frontend] 🔍 Checking generation conditions: cancelled=${cancelledRef.current}, ` +
        `sessionId=${finalSessionId}, done=${done}, hasGeneratedPaper=${hasGeneratedPaper}`
      );
      
      if (!cancelledRef.current && finalSessionId && done && !hasGeneratedPaper) {
        try {
          console.log(`[Frontend] 🚀 Starting competence paper generation...`);
          console.log(`[Frontend] 📊 Session summary: sessionId=${finalSessionId}, totalQuestions=${historyRef.current.filter(h => h.role === 'assistant').length}`);
          setStatus("generating");
          setIsGeneratingPaper(true);
          await speak("Thank you for all the information. I'm now generating the competence paper based on our conversation. This may take a moment.");
          
          console.log(`[Frontend] 📞 Calling generateConversationCompetencePaper API for session ${finalSessionId}...`);
          const startTime = Date.now();
          const generatedPaper = await generateConversationCompetencePaper(token, finalSessionId);
          const duration = Date.now() - startTime;
          
          console.log(`[Frontend] ✅ Paper generated successfully in ${duration}ms:`, generatedPaper);
          console.log(`[Frontend] 📄 Paper details: id=${generatedPaper.id}, content_length=${generatedPaper.content?.length || 0}, cv_id=${generatedPaper.cv_id}`);
          
          setHasGeneratedPaper(true);
          setGeneratedPaperId(generatedPaper.id);
          
          // Store the paper ID for later editing/exporting
          if (generatedPaper?.id) {
            console.log(`[Frontend] 💾 Stored paper ID ${generatedPaper.id} for editing/exporting`);
          }
          
          await speak("The competence paper has been generated successfully. You can now review, edit, and export it.");
          setStatus("completed");
          
          // Close the bot automatically after a short delay
          setTimeout(() => {
            console.log(`[Frontend] 🚪 Auto-closing bot after paper generation`);
            handleEnd();
          }, 5000); // 5 second delay to let user see the success message
        } catch (err: any) {
          console.error(`[Frontend] ❌ Failed to generate competence paper:`, err);
          console.error(`[Frontend] Error details:`, err?.message, err?.response);
          setError(err?.message || "Failed to generate conversation competence paper.");
          setStatus("error");
          await speak("I encountered an error while generating the competence paper. Please try again.");
        } finally {
          setIsGeneratingPaper(false);
        }
      } else {
        if (hasGeneratedPaper) {
          console.log(`[Frontend] ⏸️ Paper already generated, skipping`);
        } else if (!finalSessionId) {
          console.log(`[Frontend] ⏸️ No session ID, cannot generate paper`);
        } else if (!done) {
          console.log(`[Frontend] ⏸️ Conversation not done yet, cannot generate paper`);
        } else {
          console.log(`[Frontend] ⏸️ Skipping generation: cancelled=${cancelledRef.current}`);
        }
      }

      if (!cancelledRef.current) {
        setStatus("finished");
        if (!hasGeneratedPaper && done) {
          await speak("Thank you. The verification conversation for this CV is now complete.");
        }
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
      case "additional_info":
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
            {(status === "generating" || isGeneratingPaper) && (
              <div className="absolute -inset-1 rounded-full border border-emerald-400/40 animate-pulse" />
            )}
          </div>
          {error && <p className="text-xs text-red-300 text-center px-4">{error}</p>}
          {(status === "generating" || isGeneratingPaper) && (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin"></div>
              <p className="text-xs text-emerald-300 text-center px-4 font-medium">
                Saving the new competence paper...
              </p>
              <p className="text-xs text-slate-500 text-center px-4">
                Processing your answers and generating the document
              </p>
            </div>
          )}
          {status === "completed" && hasGeneratedPaper && (
            <div className="flex flex-col items-center gap-3 mt-2">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-emerald-300 font-semibold">Competence Paper Generated!</p>
              <p className="text-xs text-slate-400 text-center">The paper has been saved and is ready for review</p>
              {generatedPaperId && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      // Navigate to edit page or open modal - you can customize this
                      window.location.href = `/dashboard/cv?paperId=${generatedPaperId}`;
                    }}
                    className="px-4 py-2 text-xs font-medium bg-blue-500/90 hover:bg-blue-600 text-white rounded-lg transition-colors"
                  >
                    Edit & Export
                  </button>
                </div>
              )}
            </div>
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



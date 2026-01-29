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
 * - No text transcript of the conversation is shown.
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
      setStatus("speaking");
      const audio = await playTextToSpeech(text, token);
      currentAudioRef.current = audio;

      return new Promise((resolve, reject) => {
        audio.onended = () => {
          currentAudioRef.current = null;
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
          if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
          }

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
      // console.log(`[Frontend] 🚀 Starting conversation session: cvId=${cvId}, paperId=${paperId}`);
      const startRes = await startConversationSession(token, cvId, paperId);
      // console.log(`[Frontend] ✅ Session created/retrieved: session_id=${startRes.session_id}, status=${startRes.status}`);
      setSessionId(startRes.session_id);
      sessionIdRef.current = startRes.session_id; // Also store in ref for immediate access

      let currentSection: SectionKey = "core_skills";
      setSection(currentSection); // Set initial section
      let done = false;
      let allSectionsComplete = false;

      // Phase 1: 7 main sections driven by backend question generator
      while (!done && !cancelledRef.current) {
        setStatus("thinking");
        // console.log(`[Frontend] 🔄 Fetching next question for section: ${currentSection}`);
        const { question, nextSection, completeSection, done: isDone } = await fetchNextQuestion(currentSection);

        // console.log(
        //   `[Frontend] 📥 Received from backend: section=${nextSection}, complete_section=${completeSection}, done=${isDone}, question="${question?.substring(0, 50)}..."`
        // );

        // Update section immediately from backend response
        if (nextSection && nextSection !== currentSection) {
          // console.log(`[Frontend] 🔀 Section changed: ${currentSection} → ${nextSection}`);
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

        // Check if the question actually contains a question mark
        const hasQuestionMark = (question || "").includes("?");

        // If done=true and there's no question mark, it's definitely a closing statement
        // The regex check should only apply when there's actually a question mark
        const isAdditionalInfoFinalPrompt =
          currentSection === "additional_info" &&
          isDone &&
          hasQuestionMark &&
          /\b(anything else|add anything|add more|else we haven't covered)\b/i.test(question || "");

        // If this is the final turn (done=true), speak the outro and exit WITHOUT listening
        if (isDone && !isAdditionalInfoFinalPrompt) {
          // console.log(`[Frontend] 🎬 Final outro detected. Speaking and then exiting conversation loop.`);
          await speak(question);
          if (cancelledRef.current) break;
          done = true;
          break;
        }

        // For normal questions, speak then listen for answer
        setLastTranscript(""); // Clear previous transcript before asking new question
        await speak(question);
        if (cancelledRef.current) break;

        let answer = "";
        let validAnswer = false;

        // Retry loop for language validation errors
        while (!validAnswer && !cancelledRef.current) {
          try {
            // console.log(`[Frontend] 🎤 Starting to listen for answer...`);
            setStatus("listening");
            answer = await startListening();
            // console.log(`[Frontend] ✅ Received answer: "${answer}"`);

            // Set transcript to show user's answer
            if (answer) {
              setLastTranscript(answer);
            }

            // If we got here, the answer is valid (no language error)
            validAnswer = true;
          } catch (err: any) {
            const errorMessage = err?.message || "Voice input error.";

            // Check if it's a language validation error
            if (errorMessage.toLowerCase().includes("english")) {
              // console.log(`[Frontend] 🌍 Language validation error detected: "${errorMessage}"`);
              // DON'T show error on screen - only speak it
              setLastTranscript(""); // Clear transcript display

              try {
                // Speak the error out loud
                // console.log(`[Frontend] 🔊 Speaking language error: "${errorMessage}"`);
                await speak(errorMessage);

                // Wait a moment, then repeat the question
                await new Promise(resolve => setTimeout(resolve, 500));
                // console.log(`[Frontend] 🔄 Repeating question due to language error...`);
                await speak(question);

                // Continue the loop to listen again
                continue;
              } catch (speakErr) {
                console.error(`[Frontend] ❌ Error speaking language error:`, speakErr);
              }
            } else {
              // Other errors (microphone access, network, etc.) - don't retry
              console.error(`[Frontend] ❌ Non-language error:`, err);
              setError(errorMessage);
              validAnswer = true; // Exit loop, continue with empty answer
            }
          } finally {
            stopListening();
          }
        }

        if (cancelledRef.current) break;

        // If no answer (empty or silence), repeat the question
        if (!answer || !answer.trim()) {
          // console.log(`[Frontend] 🔇 No speech detected, repeating question...`);
          setLastTranscript(""); // Clear display
          await new Promise(resolve => setTimeout(resolve, 500));
          await speak(question); // Repeat the question
          // Don't add to history, just loop back to ask again
          continue;
        }

        if (answer) {
          historyRef.current.push({ role: "recruiter", content: answer });
          // console.log(`[Frontend] 📝 Added answer to history. Total history items: ${historyRef.current.length}`);

          // Store this turn in backend
          // Phase 1: validation for main sections, Phase 2: discovery for additional_info
          // Use ref to get the latest sessionId (React state updates are async)
          const currentSessionId = sessionIdRef.current || sessionId;

          if (!currentSessionId) {
            console.error("[Frontend] ❌ Cannot store conversation turn: sessionId is null");
            console.error("[Frontend] Attempting to re-create session...");
            try {
              const startRes = await startConversationSession(token, cvId, paperId);
              // console.log(`[Frontend] ✅ Re-created session: session_id=${startRes.session_id}`);
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
              // console.log(
              //   `[Frontend] ✅ Successfully stored after re-creating session: question_id=${result.question_id}, response_id=${result.response_id}`
              // );
            } catch (err: any) {
              console.error("[Frontend] ❌ Failed to re-create session:", err);
              setError("Failed to create conversation session. Please try again.");
            }
          } else {
            try {
              const phase = currentSection === "additional_info" ? "discovery" : "validation";
              // console.log(
              //   `[Frontend] 💾 Storing conversation turn: session_id=${currentSessionId}, section=${currentSection}, phase=${phase}`
              // );
              // console.log(`[Frontend] Question: ${question.substring(0, 50)}...`);
              // console.log(`[Frontend] Answer: ${answer.substring(0, 50)}...`);

              const result = await createConversationTurn(token, {
                session_id: currentSessionId,
                section: currentSection, // Use current section from backend
                phase: phase,
                question_text: question,
                answer_text: answer,
              });

              // console.log(
              //   `[Frontend] ✅ Successfully stored: question_id=${result.question_id}, response_id=${result.response_id}, status=${result.status}`
              // );
            } catch (err: any) {
              // Non-fatal; continue conversation but surface error.
              console.error("[Frontend] ❌ Failed to store conversation turn:", err);
              console.error("[Frontend] Error details:", err?.message, err?.response);
              // Try to get more details from the error
              if (err?.status === 404) {
                console.error("[Frontend] Session not found. Attempting to re-create...");
                try {
                  const startRes = await startConversationSession(token, cvId, paperId);
                  // console.log(`[Frontend] ✅ Re-created session: session_id=${startRes.session_id}`);
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

        if (isAdditionalInfoFinalPrompt) {
          // Backend sometimes marks additional_info as done too early.
          effectiveCompleteSection = false;
          effectiveDone = false;
        }

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

        // console.log(
        //   `[Frontend] 📊 Loop state: currentSection=${currentSection}, done=${done}, ` +
        //   `completeSection=${effectiveCompleteSection}, allSectionsComplete=${allSectionsComplete}`
        // );

        // If done is true, all sections including additional_info are complete
        if (done) {
          allSectionsComplete = true;
          // console.log(`[Frontend] ✅ Conversation complete! All sections done.`);
        }
      }

      // console.log(`[Frontend] 🏁 Exited main loop. done=${done}, allSectionsComplete=${allSectionsComplete}`);

      // Phase 2 is handled automatically by the backend - it will move to additional_info
      // section after all 7 main sections are complete. The main loop above handles it.

      // Phase 3: Generate competence paper (after all phases complete - when done=true)
      const finalSessionId = sessionIdRef.current || sessionId;
      // console.log(
      //   `[Frontend] 🔍 Checking generation conditions: cancelled=${cancelledRef.current}, ` +
      //   `sessionId=${finalSessionId}, done=${done}, hasGeneratedPaper=${hasGeneratedPaper}`
      // );

      if (!cancelledRef.current && finalSessionId && done && !hasGeneratedPaper) {
        try {
          // console.log(`[Frontend] 🚀 Starting competence paper generation...`);
          // console.log(`[Frontend] 📊 Session summary: sessionId=${finalSessionId}, totalQuestions=${historyRef.current.filter(h => h.role === 'assistant').length}`);
          // setStatus("generating");
          setIsGeneratingPaper(true);
          // console.log(`[Frontend] 📞 Calling generateConversationCompetencePaper API for session ${finalSessionId}...`);
          const startTime = Date.now();
          const generatedPaper = await generateConversationCompetencePaper(token, finalSessionId);
          const duration = Date.now() - startTime;

          // console.log(`[Frontend] ✅ Paper generated successfully in ${duration}ms:`, generatedPaper);
          // console.log(`[Frontend] 📄 Paper details: id=${generatedPaper.id}, content_length=${generatedPaper.content?.length || 0}, cv_id=${generatedPaper.cv_id}`);

          setHasGeneratedPaper(true);
          setGeneratedPaperId(generatedPaper.id);

          // Store the paper ID for later editing/exporting
          if (generatedPaper?.id) {
            // console.log(`[Frontend] 💾 Stored paper ID ${generatedPaper.id} for editing/exporting`);
          }

          setStatus("completed");

          // Close the bot automatically after a short delay
          setTimeout(() => {
            // console.log(`[Frontend] 🚪 Auto-closing bot after paper generation`);
            handleEnd();
          }, 5000); // 5 second delay to let user see the success message
        } catch (err: any) {
          console.error(`[Frontend] ❌ Failed to generate competence paper:`, err);
          console.error(`[Frontend] Error details:`, err?.message, err?.response);
          setError(err?.message || "Failed to generate conversation competence paper.");
          setStatus("error");
        } finally {
          setIsGeneratingPaper(false);
        }
      } else {
        if (hasGeneratedPaper) {
          // console.log(`[Frontend] ⏸️ Paper already generated, skipping`);
        } else if (!finalSessionId) {
          // console.log(`[Frontend] ⏸️ No session ID, cannot generate paper`);
        } else if (!done) {
          // console.log(`[Frontend] ⏸️ Conversation not done yet, cannot generate paper`);
        } else {
          // console.log(`[Frontend] ⏸️ Skipping generation: cancelled=${cancelledRef.current}`);
        }
      }

      if (!cancelledRef.current) {
        setStatus("finished");
        // No static outro; rely on backend-generated prompts only.
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
    stopListening();

    // Stop any currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
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
        return "Finished";
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
                  Section: {sectionLabel}
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleEnd}
            className="rounded-lg bg-red-500/90 hover:bg-red-600 text-xs font-semibold text-white px-3 py-2 shadow-lg shadow-red-500/30 transition-colors"
          >
            End Session
          </button>
        </div>

        {/* Show completion screen when finished */}
        {status === "finished" && !isGeneratingPaper && !hasGeneratedPaper ? (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 p-8 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400/40 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-emerald-200 mb-2">Interview Complete!</h3>
            <p className="text-sm text-slate-300 mb-6 max-w-md mx-auto">
              Thank you for completing the verification interview. All information has been collected successfully.
            </p>
            <button
              onClick={handleEnd}
              className="rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-sm font-semibold text-slate-950 px-6 py-3 shadow-lg shadow-emerald-500/30 transition-all hover:scale-105"
            >
              Close Interview
            </button>
          </div>
        ) : (
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
                  {(status === "generating" || isGeneratingPaper) && (
                    <span className="absolute -inset-1 rounded-full border border-emerald-400/30 animate-pulse" />
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

            {(status === "generating" || isGeneratingPaper) && (
              <div className="mt-5 flex items-center gap-3">
                <div className="h-5 w-5 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin"></div>
                <div>
                  <p className="text-xs text-emerald-300 font-medium">Generating competence paper</p>
                  <p className="text-xs text-slate-400">Processing your answers in the background.</p>
                </div>
              </div>
            )}

            {status === "completed" && hasGeneratedPaper && (
              <div className="mt-5 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                <div>
                  <p className="text-xs text-emerald-200 font-semibold">Competence paper ready</p>
                  <p className="text-xs text-emerald-200/70">Open to review or export.</p>
                </div>
                {generatedPaperId && (
                  <button
                    onClick={() => {
                      window.location.href = `/dashboard/cv?paperId=${generatedPaperId}`;
                    }}
                    className="rounded-md bg-emerald-400/90 hover:bg-emerald-400 text-xs font-semibold text-slate-950 px-3 py-1.5"
                  >
                    Open
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-slate-800/60 pt-4">
          <button
            onClick={handleEnd}
            className="rounded-lg border border-slate-700/70 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900/70 hover:border-slate-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}



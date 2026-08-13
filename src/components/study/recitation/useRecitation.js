import { useState, useCallback, useRef, useEffect } from "react";
import * as signalR from "@microsoft/signalr";
import { recitationService } from "../../../services/recitationService";
import { playMicOnSound, playMicOffSound } from "./micSounds";

function mapWordState(value) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "correct") return "Correct";
    if (normalized === "incorrect") return "Incorrect";
    if (normalized === "uncertain") return "Uncertain";
    return "Pending";
  }

  return ["Pending", "Correct", "Uncertain", "Incorrect"][value] ?? "Pending";
}

/**
 * Custom React Hook for Athar Real-time Speech Recitation via SignalR.
 *
 * Manages:
 * - SignalR connection lifecycle (MessagePack protocol)
 * - Microphone capture & AudioWorklet PCM16 resampling
 * - Client-to-server audio streaming via signalR.Subject
 * - Real-time word updates (RecitationUpdated)
 * - Sequential active word blue highlight stepping without skipping words
 * - Mic start/stop audio feedback
 */
export function useRecitation() {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [recitationStopped, setRecitationStopped] = useState(false);
  const [spokenWords, setSpokenWords] = useState([]);
  const [canonicalWords, setCanonicalWords] = useState([]);
  const [extras, setExtras] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [completedSummary, setCompletedSummary] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [furthestActiveWordIndex, setFurthestActiveWordIndex] = useState(-1);
  const [startDetection, setStartDetection] = useState(null);

  // References to preserve state across lifecycle
  const connectionRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const audioSubjectRef = useRef(null);
  const streamingPromiseRef = useRef(null);
  const sessionIdRef = useRef(null);
  const isStoppingRef = useRef(false);
  const isConnectingRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const extrasTimerRef = useRef(null);
  const completionTimerRef = useRef(null);
  const stopListeningRef = useRef(null);

  const lastUpdateNumberRef = useRef(-1);
  const lastMaxEvaluatedIdxRef = useRef(-1);

  /**
   * Reset silence timer for automatic mic shutdown
   * @param {number} durationMs - timeout duration in milliseconds (default 5000ms = 5s)
   */
  const resetSilenceTimer = useCallback((durationMs = 5000) => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      console.log(`Recitation auto-stopped after ${durationMs / 1000}s silence.`);
      stopListeningRef.current?.();
    }, durationMs);
  }, []);

  /**
   * Schedule ExtrasStrip auto-disappear 5 seconds after recitation stops/completes
   */
  const scheduleExtrasHide = useCallback(() => {
    if (extrasTimerRef.current) clearTimeout(extrasTimerRef.current);
    extrasTimerRef.current = setTimeout(() => {
      setExtras([]);
      extrasTimerRef.current = null;
    }, 5000);
  }, []);

  /**
   * Clean up Web Audio API, Microphone tracks, and active timers
   */
  const cleanupAudioResources = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    setActiveWordIndex(-1);


    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    } catch (e) {
      console.warn("Audio cleanup exception:", e);
    }
  }, []);

  /**
   * Handle real-time RecitationUpdated event from SignalR Hub.
   * Process RecitationUpdated messages in updateNumber order and apply
   * complete words snapshot received from server without calculating word positions in frontend.
   */
  const handleRecitationUpdate = useCallback((snapshot) => {
    if (!snapshot) return;

    const updateNum = snapshot.updateNumber ?? snapshot.UpdateNumber ?? null;
    if (typeof updateNum === "number") {
      if (updateNum <= lastUpdateNumberRef.current) return;
      lastUpdateNumberRef.current = updateNum;
    }

    const transcriptVal = snapshot.transcript || snapshot.Transcript || "";
    if (transcriptVal) setTranscript(transcriptVal);

    const rawExtras = Array.isArray(snapshot.extras)
      ? snapshot.extras
      : Array.isArray(snapshot.Extras)
      ? snapshot.Extras
      : [];
    setExtras(rawExtras);

    const activeIndex = snapshot.activeWordIndex ?? snapshot.ActiveWordIndex ?? null;
    setActiveWordIndex(Number.isInteger(activeIndex) ? activeIndex : -1);
    if (Number.isInteger(activeIndex)) {
      setFurthestActiveWordIndex((previous) => Math.max(previous, activeIndex));
    }

    const startDetRaw = snapshot.startDetection || snapshot.StartDetection || null;
    let detectedStartIndex = null;
    let detectionStatus = "Searching";
    if (startDetRaw) {
      detectionStatus = startDetRaw.status || startDetRaw.Status || "Searching";
      const startIndex = startDetRaw.startWordIndex ?? startDetRaw.StartWordIndex ?? null;
      if (detectionStatus === "Detected" && Number.isInteger(startIndex)) {
        detectedStartIndex = startIndex;
      }
      setStartDetection({
        status: detectionStatus,
        startWordIndex: startIndex,
        confidence: startDetRaw.confidence ?? startDetRaw.Confidence ?? 0,
        runnerUpConfidence: startDetRaw.runnerUpConfidence ?? startDetRaw.RunnerUpConfidence ?? 0,
        probeWordCount: startDetRaw.probeWordCount ?? startDetRaw.ProbeWordCount ?? 0,
        requiredProbeWordCount: startDetRaw.requiredProbeWordCount ?? startDetRaw.RequiredProbeWordCount ?? 0,
      });
    }

    const rawWords = Array.isArray(snapshot.words)
      ? snapshot.words
      : Array.isArray(snapshot.Words)
      ? snapshot.Words
      : [];
    if (rawWords.length === 0) return;

    const formattedWords = [];
    let maxEvaluatedIdx = -1;
    rawWords.forEach((word, fallbackIndex) => {
      const index = typeof word.index === "number"
        ? word.index
        : typeof word.Index === "number"
        ? word.Index
        : fallbackIndex;
      const state = mapWordState(word.state ?? word.State);
      if (state !== "Pending") maxEvaluatedIdx = Math.max(maxEvaluatedIdx, index);

      formattedWords[index] = {
        index,
        word: word.displayText || word.DisplayText || word.word || word.Word || "",
        state,
        recognizedText: word.recognizedText ?? word.RecognizedText ?? null,
        reasonCode: word.reasonCode ?? word.ReasonCode ?? null,
        similarity: word.similarity ?? word.Similarity ?? null,
        isFinalized: Boolean(word.isFinalized ?? word.IsFinalized ?? false),
      };
    });
    setSpokenWords(formattedWords);

    const evaluationStart = detectedStartIndex ?? 0;
    const relevantWords = formattedWords.filter(
      (word) => word && word.index >= evaluationStart
    );
    const detectionReady = detectionStatus === "Detected" || detectionStatus === "Disabled";
    const allCompleted = detectionReady
      && relevantWords.length > 0
      && relevantWords.every((word) => word.state !== "Pending");

    if (allCompleted && maxEvaluatedIdx !== -1) {
      if (!isStoppingRef.current && !completionTimerRef.current) {
        completionTimerRef.current = setTimeout(() => {
          completionTimerRef.current = null;
          stopListeningRef.current?.();
        }, 1300);
      }
    } else if (maxEvaluatedIdx > lastMaxEvaluatedIdxRef.current) {
      lastMaxEvaluatedIdxRef.current = maxEvaluatedIdx;
      resetSilenceTimer(5000);
    }
  }, [resetSilenceTimer]);
  /**
   * Handle RecitationCompleted event from SignalR Hub
   */
  const handleRecitationCompleted = useCallback((result) => {
    // Ignore completion events while connecting
    if (isConnectingRef.current) {
      console.log("RecitationCompleted ignored during connection setup.");
      return;
    }
    const detectedStartIdx =
      result?.detectedStartWordIndex !== undefined && result?.detectedStartWordIndex !== null
        ? result.detectedStartWordIndex
        : result?.DetectedStartWordIndex !== undefined && result?.DetectedStartWordIndex !== null
        ? result.DetectedStartWordIndex
        : null;

    if (!isStoppingRef.current) {
      playMicOffSound();
    }
    cleanupAudioResources();

    setCompletedSummary({
      ...result,
      detectedStartWordIndex: detectedStartIdx,
    });
    setIsListening(false);
    setIsConnecting(false);
    setRecitationStopped(true);
    setActiveWordIndex(-1);
    scheduleExtrasHide();
  }, [cleanupAudioResources, scheduleExtrasHide]);

  /**
   * Translate raw server error to user-friendly Arabic message
   */
  const translateRecitationError = (rawError) => {
    if (!rawError) return null;
    const msg = typeof rawError === "string"
      ? rawError
      : (rawError?.message || rawError?.code || rawError?.name || String(rawError || ""));

    const s = msg.toLowerCase();

    // Ignore benign / session recovery errors
    if (
      s.includes("session_not_found") ||
      s.includes("active_session_exists") ||
      s.includes("canceled") ||
      s.includes("abort") ||
      s.includes("stopped")
    ) {
      return null;
    }

    // Specific user-friendly error messages
    if (s.includes("notallowederror") || s.includes("permission denied") || s.includes("permissiondenied")) {
      return "يرجى السماح للمتصفح بالوصول إلى المايكروفون لبدء التسميع.";
    }
    if (s.includes("notfounderror") || s.includes("no microphone")) {
      return "لم يتم العثور على مايكروفون متصل بجهازك.";
    }
    if (s.includes("hadith_not_found")) {
      return "الحديث المطلوب غير موجود على السيرفر.";
    }
    if (s.includes("token_revoked") || s.includes("401") || s.includes("unauthorized")) {
      return "انتهت جلسة تسجيل الدخول، يرجى إعادة تسجيل الدخول لمتابعة التسميع.";
    }
    if (s.includes("provider_unavailable")) {
      return "خدمة التسميع بالذكاء الاصطناعي غير متوفرة حالياً، يرجى المحاولة لاحقاً.";
    }
    if (s.includes("session_start_failed")) {
      return "تعذر بدء جلسة التسميع على السيرفر.";
    }

    return "حدث خطأ غير متوقع أثناء التسميع الصوتي. يرجى المحاولة لاحقاً.";
  };

  /**
   * Handle RecitationError event from SignalR Hub
   */
  const handleRecitationError = useCallback((err) => {
    console.warn("RecitationError received:", err);

    // Ignore non-fatal warnings (e.g. NO_SPEECH_DETECTED, LOW_AUDIO_QUALITY)
    if (!err || err.fatal !== true) return;

    // Ignore errors during stopping or starting phases
    if (isStoppingRef.current) return;

    const friendlyMsg = translateRecitationError(err);
    if (!friendlyMsg) return;

    setErrorMsg(friendlyMsg);
    setActiveWordIndex(-1);
    cleanupAudioResources();
    setIsListening(false);
    setIsConnecting(false);
    setRecitationStopped(true);
  }, [translateRecitationError]);

  /**
   * Start recitation session
   */
  const startListening = useCallback(async (hadithId) => {
    if (!hadithId) {
      setErrorMsg("رقم الحديث غير محدد.");
      return;
    }

    try {
      isConnectingRef.current = true;
      isStoppingRef.current = false;
      setErrorMsg(null);
      setSpokenWords([]);
      setCanonicalWords([]);
      setTranscript("");
      setCompletedSummary(null);
      setRecitationStopped(false);
      setStartDetection(null);
      setActiveWordIndex(-1);
      setFurthestActiveWordIndex(-1);
      lastUpdateNumberRef.current = -1;
      lastMaxEvaluatedIdxRef.current = -1;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      setIsConnecting(true);

      // If an existing connection exists, ensure cleanup first
      if (connectionRef.current) {
        await recitationService.stopConnection(connectionRef.current);
        connectionRef.current = null;
      }

      // 1. Build and start SignalR Connection with event handlers
      let connection = await recitationService.buildConnection({
        onUpdated: handleRecitationUpdate,
        onCompleted: handleRecitationCompleted,
        onError: handleRecitationError,
      });
      connectionRef.current = connection;

      // Clear previous session ID references
      localStorage.removeItem("recitation_session_id");
      sessionIdRef.current = null;

      // 2. Invoke StartRecitation(hadithId) with auto-recovery for ACTIVE_SESSION_EXISTS
      let started = null;
      try {
        started = await recitationService.startRecitation(connection, hadithId);
      } catch (startErr) {
        const errStr = String(startErr?.message || startErr || "").toLowerCase();
        if (errStr.includes("active_session_exists") || errStr.includes("session")) {
          console.warn("Active session exists, reconnecting and retrying...");
          try {
            await recitationService.stopConnection(connection).catch(() => {});
            await new Promise((r) => setTimeout(r, 250));
            connection = await recitationService.buildConnection({
              onUpdated: handleRecitationUpdate,
              onCompleted: handleRecitationCompleted,
              onError: handleRecitationError,
            });
            connectionRef.current = connection;
            started = await recitationService.startRecitation(connection, hadithId);
          } catch (retryErr) {
            console.warn("StartRecitation retry failed:", retryErr);
            throw startErr;
          }
        } else {
          throw startErr;
        }
      }

      if (!started || !started.sessionId) {
        throw new Error("لم نتمكن من بدء جلسة التسميع على السيرفر");
      }
      sessionIdRef.current = started.sessionId;
      localStorage.setItem("recitation_session_id", started.sessionId);

      const startedWords = Array.isArray(started.words)
        ? started.words
        : Array.isArray(started.Words)
        ? started.Words
        : [];
      const initialWords = [];
      const initialCanonicalWords = [];
      startedWords.forEach((word, fallbackIndex) => {
        const index = typeof word.index === "number"
          ? word.index
          : typeof word.Index === "number"
          ? word.Index
          : fallbackIndex;
        const displayText = word.displayText
          || word.DisplayText
          || word.word
          || word.Word
          || "";
        initialCanonicalWords[index] = { index, word: displayText };
        initialWords[index] = {
          index,
          word: displayText,
          state: "Pending",
          recognizedText: null,
          reasonCode: "not-reached",
          isFinalized: false,
        };
      });
      setCanonicalWords(initialCanonicalWords);
      setSpokenWords(initialWords);
      // 4. Create audio Subject for streaming
      const audioSubject = new signalR.Subject();
      audioSubjectRef.current = audioSubject;

      // 5. Invoke StreamAudio(sessionId, audioSubject)
      const streamingPromise = recitationService.streamAudio(
        connection,
        started.sessionId,
        audioSubject
      );
      streamingPromiseRef.current = streamingPromise;

      // 6. Initialize Microphone & AudioWorklet
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/pcm-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        const chunk = data.chunk || (data instanceof Uint8Array ? data : null);

        if (chunk && audioSubjectRef.current) {
          audioSubjectRef.current.next(chunk);
        }
      };

      source.connect(workletNode);
      // Connect to destination to keep worklet active (muted)
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      workletNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      isConnectingRef.current = false;
      setIsConnecting(false);
      setIsListening(true);
      resetSilenceTimer(6000); // Initial 6-second silence window
      playMicOnSound();
    } catch (err) {
      console.error("Failed to start recitation:", err);
      isConnectingRef.current = false;
      if (!isStoppingRef.current) {
        setErrorMsg(translateRecitationError(err));
      }
      cleanupAudioResources();
      if (connectionRef.current) {
        await recitationService.stopConnection(connectionRef.current);
        connectionRef.current = null;
      }
      setIsConnecting(false);
      setIsListening(false);
    }
  }, [handleRecitationUpdate, handleRecitationCompleted, handleRecitationError, cleanupAudioResources]);

  /**
   * Stop recitation session gracefully and send FinishRecitation.
   * Captures local refs at start to prevent race conditions with rapid stop+start.
   */
  const stopListening = useCallback(async () => {
    stopListeningRef.current = stopListening;
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // Capture references NOW before any async work — prevents race condition
    // where startListening replaces connectionRef while we're still stopping.
    const conn = connectionRef.current;
    const sid = sessionIdRef.current;
    const subject = audioSubjectRef.current;
    const streamPromise = streamingPromiseRef.current;

    playMicOffSound();

    // Immediately stop local microphone hardware tracks & AudioContext
    cleanupAudioResources();
    setIsListening(false);
    setIsConnecting(false);
    setRecitationStopped(true);
    scheduleExtrasHide();

    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage("FLUSH");
      }

      // Complete the audio subject stream
      if (subject) {
        subject.complete();
        audioSubjectRef.current = null;
      }

      // Await streaming promise to finish
      if (streamPromise) {
        await streamPromise.catch(() => {});
        streamingPromiseRef.current = null;
      }

      // Invoke FinishRecitation(sessionId)
      if (conn && sid) {
        await recitationService.finishRecitation(conn, sid).catch(() => {});
      }
    } catch (err) {
      console.warn("Error stopping recitation session:", err);
    } finally {
      // Only close the connection we captured, not a potentially new one
      if (conn) {
        await recitationService.stopConnection(conn).catch(() => {});
        if (connectionRef.current === conn) {
          connectionRef.current = null;
        }
      }
      if (sessionIdRef.current === sid) {
        sessionIdRef.current = null;
      }
      localStorage.removeItem("recitation_session_id");
    }
  }, [cleanupAudioResources, scheduleExtrasHide]);

  // Keep stopListeningRef updated safely without render-phase ref mutation
  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  const requestHint = useCallback(async (wordCount) => {
    const connection = connectionRef.current;
    const sessionId = sessionIdRef.current;
    if (!connection || !sessionId || !isListening) return null;

    try {
      return await recitationService.requestHint(connection, sessionId, wordCount);
    } catch (error) {
      console.warn("RequestHint failed:", error);
      setErrorMsg("تعذر إظهار التلميح الآن، يرجى المحاولة مرة أخرى.");
      return null;
    }
  }, [isListening]);
  /**
   * Cancel recitation session without saving
   */
  const cancelRecitation = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    playMicOffSound();
    setIsListening(false);
    setIsConnecting(false);
    try {
      cleanupAudioResources();
      if (audioSubjectRef.current) {
        audioSubjectRef.current.complete();
      }
      if (connectionRef.current && sessionIdRef.current) {
        await recitationService.cancelRecitation(
          connectionRef.current,
          sessionIdRef.current
        ).catch(() => {});
      }
    } catch (err) {
      console.warn("Cancel recitation exception:", err);
    } finally {
      if (connectionRef.current) {
        await recitationService.stopConnection(connectionRef.current).catch(() => {});
        connectionRef.current = null;
      }
      sessionIdRef.current = null;
      localStorage.removeItem("recitation_session_id");
      setRecitationStopped(true);
    }
  }, [cleanupAudioResources]);

  /**
   * Reset local state
   */
  const resetRecitation = useCallback(() => {
    setSpokenWords([]);
    setCanonicalWords([]);
    setExtras([]);
    setStartDetection(null);
    if (extrasTimerRef.current) {
      clearTimeout(extrasTimerRef.current);
      extrasTimerRef.current = null;
    }
    setTranscript("");
    setCompletedSummary(null);
    setErrorMsg(null);
    setRecitationStopped(false);
    setActiveWordIndex(-1);
    setFurthestActiveWordIndex(-1);
    lastUpdateNumberRef.current = -1;
    lastMaxEvaluatedIdxRef.current = -1;

    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }, []);

  // Cleanup resources when component unmounts
  useEffect(() => {
    return () => {
      cleanupAudioResources();
      if (connectionRef.current) {
        recitationService.stopConnection(connectionRef.current);
      }
    };
  }, [cleanupAudioResources]);

  return {
    isListening,
    isConnecting,
    recitationStopped,
    spokenWords,
    canonicalWords,
    extras,
    transcript,
    completedSummary,
    errorMsg,
    activeWordIndex,
    furthestActiveWordIndex,
    startDetection,
    startListening,
    stopListening,
    requestHint,
    cancelRecitation,
    resetRecitation,
  };
}

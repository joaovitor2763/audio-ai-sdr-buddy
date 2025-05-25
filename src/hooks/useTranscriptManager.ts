
import { useRef, useCallback, useState } from 'react';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
}

export const useTranscriptManager = () => {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  
  const pendingUserTranscriptRef = useRef<string>("");
  const pendingAiTranscriptRef = useRef<string>("");
  const isUserTurnRef = useRef(false);
  const isAiTurnRef = useRef(false);
  const userTranscriptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastUserTextRef = useRef<string>("");

  // Reduced delays and thresholds for better Live API integration
  const TRANSCRIPT_FINALIZATION_DELAY = 2000;
  const MIN_TEXT_LENGTH_FOR_FINALIZATION = 3; // Reduced minimum length
  const MIN_MEANINGFUL_LENGTH = 5; // Reduced for Live API

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const textToFinalize = pendingUserTranscriptRef.current.trim();
    
    console.log("Attempting to finalize user transcript:", {
      text: textToFinalize,
      length: textToFinalize.length,
      lastUserText: lastUserTextRef.current
    });
    
    // More permissive conditions for finalization with Live API
    if (textToFinalize && 
        textToFinalize !== lastUserTextRef.current && 
        textToFinalize.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION) {
      
      console.log("Finalizing user transcript:", textToFinalize);
      const entry = addToTranscript("Usuário", textToFinalize);
      lastUserTextRef.current = textToFinalize;
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      return entry;
    } else {
      console.log("User transcript not finalized:", {
        hasText: !!textToFinalize,
        isDifferent: textToFinalize !== lastUserTextRef.current,
        meetsLength: textToFinalize.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION
      });
    }
    return null;
  }, [addToTranscript]);

  // Simplified transcript handling for Live API input transcription
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("Live API user transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length
    });
    
    // Skip empty content but be more permissive
    if (!transcriptText.trim() || transcriptText.trim().length < 2) {
      console.log("Skipping empty/short transcript:", transcriptText);
      return null;
    }

    const trimmedText = transcriptText.trim();
    
    // For Live API, we trust the input transcription more
    pendingUserTranscriptRef.current = trimmedText;
    isUserTurnRef.current = true;
    
    console.log("Updated pending user transcript:", trimmedText);
    
    // Clear existing timeout
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
      userTranscriptTimeoutRef.current = null;
    }
    
    // If marked as final by Live API, finalize immediately
    if (isFinal) {
      console.log("Live API marked as final, finalizing immediately:", trimmedText);
      return finalizeUserTranscript();
    }
    
    // Set a shorter timeout for Live API
    userTranscriptTimeoutRef.current = setTimeout(() => {
      console.log("Live API transcript timeout reached, finalizing");
      finalizeUserTranscript();
    }, TRANSCRIPT_FINALIZATION_DELAY);
    
    return null;
  }, [finalizeUserTranscript]);

  const handleAiTranscript = useCallback((text: string) => {
    console.log("Mari text received:", text);
    isAiTurnRef.current = true;
    pendingAiTranscriptRef.current += text;
  }, []);

  const handleInterruption = useCallback(() => {
    console.log("Handling transcript interruption");
    
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
      userTranscriptTimeoutRef.current = null;
    }
    
    // More aggressive finalization on interruption for Live API
    if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
      console.log("Finalizing interrupted user transcript:", pendingUserTranscriptRef.current);
      return finalizeUserTranscript();
    }
    
    return null;
  }, [finalizeUserTranscript]);

  const handleTurnComplete = useCallback(() => {
    console.log("Turn completed - pending user:", pendingUserTranscriptRef.current, "pending AI:", pendingAiTranscriptRef.current);
    
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
      userTranscriptTimeoutRef.current = null;
    }
    
    const results = [];
    
    // First finalize AI transcript if exists
    if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
      console.log("Finalizing AI transcript:", pendingAiTranscriptRef.current);
      results.push(addToTranscript("Mari", pendingAiTranscriptRef.current.trim()));
      pendingAiTranscriptRef.current = "";
      isAiTurnRef.current = false;
    }
    
    // Then finalize user transcript if exists (more permissive for Live API)
    if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
      console.log("Finalizing user transcript on turn complete:", pendingUserTranscriptRef.current);
      const entry = finalizeUserTranscript();
      if (entry) results.push(entry);
    }
    
    return results;
  }, [addToTranscript, finalizeUserTranscript]);

  const handleGenerationComplete = useCallback(() => {
    console.log("Generation completed");
    
    if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
      console.log("Finalizing AI transcript on generation complete:", pendingAiTranscriptRef.current);
      const entry = addToTranscript("Mari", pendingAiTranscriptRef.current.trim());
      pendingAiTranscriptRef.current = "";
      isAiTurnRef.current = false;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  const clearTranscripts = useCallback(() => {
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
      userTranscriptTimeoutRef.current = null;
    }
    
    pendingUserTranscriptRef.current = "";
    pendingAiTranscriptRef.current = "";
    lastUserTextRef.current = "";
    isUserTurnRef.current = false;
    isAiTurnRef.current = false;
    setTranscript([]);
  }, []);

  return {
    transcript,
    addToTranscript,
    handleUserTranscript,
    handleAiTranscript,
    handleInterruption,
    handleTurnComplete,
    handleGenerationComplete,
    clearTranscripts
  };
};

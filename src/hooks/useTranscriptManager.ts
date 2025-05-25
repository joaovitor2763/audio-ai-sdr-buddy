
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

  // Reduced delays for better responsiveness with Live API transcription
  const TRANSCRIPT_FINALIZATION_DELAY = 1500; // Reduced from 4000ms
  const MIN_TEXT_LENGTH_FOR_FINALIZATION = 3; // Reduced minimum length

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const textToFinalize = pendingUserTranscriptRef.current.trim();
    
    if (textToFinalize && textToFinalize !== lastUserTextRef.current && textToFinalize.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION) {
      console.log("Finalizing user transcript:", textToFinalize);
      const entry = addToTranscript("Usuário", textToFinalize);
      lastUserTextRef.current = textToFinalize;
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  // Simplified transcript handling for Live API transcription
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("User transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length
    });
    
    // Skip empty or very short fragments
    if (!transcriptText.trim() || transcriptText.trim().length < 2) {
      return null;
    }

    const trimmedText = transcriptText.trim();
    
    // For Live API, we get cleaner transcription, so we can be more direct
    if (isFinal || transcriptText.length > 10) {
      // Clear any existing timeout
      if (userTranscriptTimeoutRef.current) {
        clearTimeout(userTranscriptTimeoutRef.current);
        userTranscriptTimeoutRef.current = null;
      }
      
      // If this looks like a complete thought, finalize immediately
      if (trimmedText.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION && trimmedText !== lastUserTextRef.current) {
        pendingUserTranscriptRef.current = trimmedText;
        return finalizeUserTranscript();
      }
    } else {
      // For partial transcripts, accumulate with shorter timeout
      pendingUserTranscriptRef.current = trimmedText;
      isUserTurnRef.current = true;
      
      if (userTranscriptTimeoutRef.current) {
        clearTimeout(userTranscriptTimeoutRef.current);
      }
      
      userTranscriptTimeoutRef.current = setTimeout(() => {
        console.log("Transcript timeout reached, finalizing user input");
        finalizeUserTranscript();
      }, TRANSCRIPT_FINALIZATION_DELAY);
    }
    
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
    
    if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
      console.log("Finalizing interrupted user transcript:", pendingUserTranscriptRef.current);
      return finalizeUserTranscript();
    }
    return null;
  }, [finalizeUserTranscript]);

  const handleTurnComplete = useCallback(() => {
    console.log("Turn completed");
    
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
    
    // Then finalize user transcript if exists
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

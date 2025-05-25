
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

  // Increased delay for better sentence completion
  const TRANSCRIPT_FINALIZATION_DELAY = 2000;

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    if (pendingUserTranscriptRef.current.trim() && pendingUserTranscriptRef.current !== lastUserTextRef.current) {
      console.log("Finalizing user transcript:", pendingUserTranscriptRef.current);
      const entry = addToTranscript("Usuário", pendingUserTranscriptRef.current.trim());
      lastUserTextRef.current = pendingUserTranscriptRef.current;
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  const handleUserTranscript = useCallback((transcriptText: string, isPartial?: boolean) => {
    console.log("User transcript received:", {
      text: transcriptText,
      isPartial: isPartial,
      length: transcriptText.length,
      isDifferent: transcriptText !== lastUserTextRef.current
    });
    
    // Skip if text hasn't changed meaningfully
    if (!transcriptText.trim() || transcriptText === lastUserTextRef.current) {
      return null;
    }

    // For input transcriptions from Live API, we get continuous updates
    // We'll accumulate the text and finalize it after a delay
    pendingUserTranscriptRef.current = transcriptText;
    isUserTurnRef.current = true;
    
    // Clear any existing timeout
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
    }
    
    // Set timeout to finalize transcript after user stops speaking
    // Only if we have substantial content
    if (transcriptText.trim().length > 5) {
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

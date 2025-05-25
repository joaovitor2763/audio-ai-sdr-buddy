
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
  const lastInputTranscriptRef = useRef<string>("");

  // Increased delays for better speech accumulation with Live API
  const TRANSCRIPT_FINALIZATION_DELAY = 3000; // Increased for better accumulation
  const MIN_TEXT_LENGTH_FOR_FINALIZATION = 8; // Increased minimum length
  const MIN_MEANINGFUL_LENGTH = 15; // Only finalize longer, more meaningful phrases

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const textToFinalize = pendingUserTranscriptRef.current.trim();
    
    // More strict conditions for finalization
    if (textToFinalize && 
        textToFinalize !== lastUserTextRef.current && 
        textToFinalize.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION &&
        !textToFinalize.includes('<noise>') && // Filter out noise
        !/^[a-zA-Z]$/.test(textToFinalize)) { // Filter out single letters
      
      console.log("Finalizing user transcript:", textToFinalize);
      const entry = addToTranscript("Usuário", textToFinalize);
      lastUserTextRef.current = textToFinalize;
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      lastInputTranscriptRef.current = "";
      return entry;
    }
    return null;
  }, [addToTranscript]);

  // Improved transcript handling for Live API input transcription
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("User transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length,
      current: pendingUserTranscriptRef.current
    });
    
    // Skip empty, very short, or noise-only content
    if (!transcriptText.trim() || 
        transcriptText.trim().length < 2 || 
        transcriptText.includes('<noise>') ||
        /^[a-zA-Z]$/.test(transcriptText.trim())) {
      console.log("Skipping short/noise transcript:", transcriptText);
      return null;
    }

    const trimmedText = transcriptText.trim();
    
    // Check if this is a continuation or completely new text
    const isNewText = !lastInputTranscriptRef.current || !trimmedText.startsWith(lastInputTranscriptRef.current);
    
    if (isNewText) {
      // This is new text, replace what we have
      pendingUserTranscriptRef.current = trimmedText;
      console.log("New user text detected:", trimmedText);
    } else if (trimmedText.length > lastInputTranscriptRef.current.length) {
      // This is an extension of previous text
      pendingUserTranscriptRef.current = trimmedText;
      console.log("Extended user text:", trimmedText);
    }
    
    lastInputTranscriptRef.current = trimmedText;
    isUserTurnRef.current = true;
    
    // Clear existing timeout
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
      userTranscriptTimeoutRef.current = null;
    }
    
    // Only finalize if it's marked as final AND meets length requirements
    if (isFinal && trimmedText.length >= MIN_MEANINGFUL_LENGTH) {
      console.log("Final transcript received, finalizing:", trimmedText);
      return finalizeUserTranscript();
    }
    
    // Set timeout for auto-finalization with longer delay
    userTranscriptTimeoutRef.current = setTimeout(() => {
      console.log("Transcript timeout reached, checking for finalization");
      if (pendingUserTranscriptRef.current.length >= MIN_MEANINGFUL_LENGTH) {
        finalizeUserTranscript();
      } else {
        console.log("Text too short for finalization:", pendingUserTranscriptRef.current);
      }
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
    
    // More selective finalization on interruption
    if (isUserTurnRef.current && 
        pendingUserTranscriptRef.current.trim() &&
        pendingUserTranscriptRef.current.length >= MIN_MEANINGFUL_LENGTH) {
      console.log("Finalizing interrupted user transcript:", pendingUserTranscriptRef.current);
      return finalizeUserTranscript();
    }
    
    // Clear incomplete fragments
    if (pendingUserTranscriptRef.current.length < MIN_MEANINGFUL_LENGTH) {
      console.log("Clearing incomplete user transcript fragment:", pendingUserTranscriptRef.current);
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      lastInputTranscriptRef.current = "";
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
    
    // Then finalize user transcript only if meaningful
    if (isUserTurnRef.current && 
        pendingUserTranscriptRef.current.trim() &&
        pendingUserTranscriptRef.current.length >= MIN_MEANINGFUL_LENGTH) {
      console.log("Finalizing user transcript on turn complete:", pendingUserTranscriptRef.current);
      const entry = finalizeUserTranscript();
      if (entry) results.push(entry);
    } else if (pendingUserTranscriptRef.current.length > 0) {
      console.log("Clearing incomplete user transcript on turn complete:", pendingUserTranscriptRef.current);
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      lastInputTranscriptRef.current = "";
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
    lastInputTranscriptRef.current = "";
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

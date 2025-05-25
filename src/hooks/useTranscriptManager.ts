
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
  const accumulatedUserTextRef = useRef<string>("");

  // Longer delay to wait for complete sentences
  const TRANSCRIPT_FINALIZATION_DELAY = 3000;
  const MIN_TEXT_LENGTH_FOR_FINALIZATION = 3;

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const textToFinalize = accumulatedUserTextRef.current.trim();
    
    if (textToFinalize && textToFinalize !== lastUserTextRef.current && textToFinalize.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION) {
      console.log("Finalizing accumulated user transcript:", textToFinalize);
      const entry = addToTranscript("Usuário", textToFinalize);
      lastUserTextRef.current = textToFinalize;
      accumulatedUserTextRef.current = "";
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  const handleUserTranscript = useCallback((transcriptText: string, isPartial?: boolean) => {
    console.log("User transcript fragment received:", {
      text: transcriptText,
      isPartial: isPartial,
      length: transcriptText.length,
      currentAccumulated: accumulatedUserTextRef.current
    });
    
    // Skip empty or very short meaningless fragments
    if (!transcriptText.trim() || transcriptText.trim().length < 1) {
      return null;
    }

    // For Live API, we get individual word/phrase fragments
    // We need to accumulate them into complete sentences
    const trimmedText = transcriptText.trim();
    
    // Add this fragment to our accumulated text
    if (accumulatedUserTextRef.current) {
      // Check if this fragment should be concatenated with a space or not
      const needsSpace = !accumulatedUserTextRef.current.endsWith(' ') && !trimmedText.startsWith(' ');
      accumulatedUserTextRef.current += (needsSpace ? ' ' : '') + trimmedText;
    } else {
      accumulatedUserTextRef.current = trimmedText;
    }
    
    console.log("Accumulated user text now:", accumulatedUserTextRef.current);
    
    isUserTurnRef.current = true;
    
    // Clear any existing timeout
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
    }
    
    // Set timeout to finalize transcript after user stops speaking
    // Only if we have meaningful accumulated content
    if (accumulatedUserTextRef.current.trim().length >= MIN_TEXT_LENGTH_FOR_FINALIZATION) {
      userTranscriptTimeoutRef.current = setTimeout(() => {
        console.log("Transcript timeout reached, finalizing accumulated user input");
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
    
    if (isUserTurnRef.current && accumulatedUserTextRef.current.trim()) {
      console.log("Finalizing interrupted accumulated user transcript:", accumulatedUserTextRef.current);
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
    
    // Then finalize accumulated user transcript if exists
    if (isUserTurnRef.current && accumulatedUserTextRef.current.trim()) {
      console.log("Finalizing accumulated user transcript on turn complete:", accumulatedUserTextRef.current);
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
    accumulatedUserTextRef.current = "";
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

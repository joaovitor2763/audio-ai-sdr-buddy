
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
  const lastPartialTextRef = useRef<string>("");

  // Increased delay to allow for better sentence completion
  const TRANSCRIPT_FINALIZATION_DELAY = 2000; // Increased back to 2000ms for better sentence capture

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    if (pendingUserTranscriptRef.current.trim()) {
      console.log("Finalizing user transcript:", pendingUserTranscriptRef.current);
      const entry = addToTranscript("Usuário", pendingUserTranscriptRef.current.trim());
      pendingUserTranscriptRef.current = "";
      lastPartialTextRef.current = "";
      isUserTurnRef.current = false;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  const handleUserTranscript = useCallback((transcriptText: string, isPartial?: boolean) => {
    console.log("User transcript received:", transcriptText, "isPartial:", isPartial);
    
    // If this is a partial result, only update if it's significantly different or longer
    if (isPartial) {
      // Only update if the new text is meaningfully different
      if (transcriptText.length > lastPartialTextRef.current.length || 
          !transcriptText.startsWith(lastPartialTextRef.current.substring(0, Math.min(10, lastPartialTextRef.current.length)))) {
        pendingUserTranscriptRef.current = transcriptText;
        lastPartialTextRef.current = transcriptText;
        isUserTurnRef.current = true;
        
        console.log("Updated partial transcript:", transcriptText);
        
        // Clear any existing timeout
        if (userTranscriptTimeoutRef.current) {
          clearTimeout(userTranscriptTimeoutRef.current);
        }
        
        // Set timeout for partial results
        userTranscriptTimeoutRef.current = setTimeout(() => {
          console.log("Transcript timeout reached, finalizing user input");
          finalizeUserTranscript();
        }, TRANSCRIPT_FINALIZATION_DELAY);
      }
      return null;
    } else {
      // This is a final result - finalize immediately
      console.log("Final transcript received, finalizing immediately");
      
      // Clear any existing timeout
      if (userTranscriptTimeoutRef.current) {
        clearTimeout(userTranscriptTimeoutRef.current);
        userTranscriptTimeoutRef.current = null;
      }
      
      // Update with final text and finalize
      pendingUserTranscriptRef.current = transcriptText;
      return finalizeUserTranscript();
    }
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
    lastPartialTextRef.current = "";
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

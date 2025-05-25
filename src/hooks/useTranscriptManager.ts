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
  const lastFragmentTimeRef = useRef<number>(0);

  // Increased delay for better sentence accumulation
  const TRANSCRIPT_FINALIZATION_DELAY = 4000;
  const MIN_TEXT_LENGTH_FOR_FINALIZATION = 5;
  const FRAGMENT_MERGE_THRESHOLD = 500; // ms between fragments to consider merging

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const cleanAndMergeText = (newText: string, existingText: string): string => {
    // Remove extra spaces and normalize
    const cleanNew = newText.trim();
    const cleanExisting = existingText.trim();
    
    if (!cleanExisting) return cleanNew;
    if (!cleanNew) return cleanExisting;
    
    // Check if new text should be concatenated directly or with space
    const lastChar = cleanExisting.slice(-1);
    const firstChar = cleanNew.charAt(0);
    
    // If the existing text ends with a space or the new text starts with a space, don't add extra space
    if (lastChar === ' ' || firstChar === ' ') {
      return cleanExisting + cleanNew;
    }
    
    // Add space between words
    return cleanExisting + ' ' + cleanNew;
  };

  const finalizeUserTranscript = useCallback(() => {
    const textToFinalize = accumulatedUserTextRef.current.trim();
    
    if (textToFinalize && textToFinalize !== lastUserTextRef.current && textToFinalize.length >= MIN_TEXT_LENGTH_FOR_FINALIZATION) {
      console.log("Finalizing accumulated user transcript:", textToFinalize);
      const entry = addToTranscript("Usuário", textToFinalize);
      lastUserTextRef.current = textToFinalize;
      accumulatedUserTextRef.current = "";
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      lastFragmentTimeRef.current = 0;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  const handleUserTranscript = useCallback((transcriptText: string, isPartial?: boolean) => {
    const now = Date.now();
    
    console.log("User transcript fragment received:", {
      text: transcriptText,
      isPartial: isPartial,
      length: transcriptText.length,
      currentAccumulated: accumulatedUserTextRef.current,
      timeSinceLastFragment: now - lastFragmentTimeRef.current
    });
    
    // Skip empty or very short meaningless fragments
    if (!transcriptText.trim() || transcriptText.trim().length < 1) {
      return null;
    }

    const trimmedText = transcriptText.trim();
    
    // If too much time has passed since last fragment, treat this as a new sentence
    if (lastFragmentTimeRef.current > 0 && (now - lastFragmentTimeRef.current) > FRAGMENT_MERGE_THRESHOLD * 3) {
      console.log("Gap detected, finalizing previous text and starting new");
      if (accumulatedUserTextRef.current.trim().length >= MIN_TEXT_LENGTH_FOR_FINALIZATION) {
        finalizeUserTranscript();
      } else {
        accumulatedUserTextRef.current = "";
      }
    }
    
    // Accumulate the text
    accumulatedUserTextRef.current = cleanAndMergeText(trimmedText, accumulatedUserTextRef.current);
    lastFragmentTimeRef.current = now;
    
    console.log("Accumulated user text now:", accumulatedUserTextRef.current);
    
    isUserTurnRef.current = true;
    
    // Clear any existing timeout
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
    }
    
    // Set timeout to finalize transcript after user stops speaking
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
    lastFragmentTimeRef.current = 0;
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

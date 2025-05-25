
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
  const lastUserTextRef = useRef<string>("");

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    console.log(`Added to transcript: ${speaker}: ${text}`);
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const textToFinalize = pendingUserTranscriptRef.current.trim();
    
    console.log("Finalizing user transcript:", {
      text: textToFinalize,
      length: textToFinalize.length,
      lastUserText: lastUserTextRef.current
    });
    
    // Filter out noise and ensure we have meaningful content
    const cleanedText = textToFinalize.replace(/<noise>/g, '').trim();
    
    if (cleanedText && cleanedText !== lastUserTextRef.current && cleanedText.length >= 2) {
      console.log("Adding finalized user transcript:", cleanedText);
      const entry = addToTranscript("Usuário", cleanedText);
      lastUserTextRef.current = cleanedText;
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
      return entry;
    }
    
    return null;
  }, [addToTranscript]);

  // Accumulate user input fragments during their turn
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("Live API user transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length,
      currentTurn: isUserTurnRef.current ? 'user' : 'none'
    });
    
    // Skip empty content or pure noise
    if (!transcriptText.trim() || transcriptText.trim() === '<noise>') {
      return null;
    }

    const trimmedText = transcriptText.trim();
    
    // Start user turn if not already active
    if (!isUserTurnRef.current) {
      console.log("Starting user turn");
      isUserTurnRef.current = true;
      pendingUserTranscriptRef.current = "";
    }
    
    // Accumulate the fragments - this is the key fix
    if (pendingUserTranscriptRef.current) {
      // Add space between fragments if needed and not already present
      const needsSpace = !pendingUserTranscriptRef.current.endsWith(' ') && !trimmedText.startsWith(' ');
      pendingUserTranscriptRef.current += (needsSpace ? ' ' : '') + trimmedText;
    } else {
      pendingUserTranscriptRef.current = trimmedText;
    }
    
    console.log("Accumulated user text:", pendingUserTranscriptRef.current);
    
    // Don't finalize here - wait for turn detection
    return null;
  }, []);

  const handleAiTranscript = useCallback((text: string) => {
    console.log("AI text received:", text);
    
    // If we have pending user transcript and AI is starting to speak, finalize user turn
    if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
      console.log("AI speaking detected - finalizing pending user transcript");
      finalizeUserTranscript();
    }
    
    isAiTurnRef.current = true;
    pendingAiTranscriptRef.current += text;
  }, [finalizeUserTranscript]);

  const handleInterruption = useCallback(() => {
    console.log("Handling transcript interruption");
    
    // Finalize any pending user transcript on interruption
    if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
      console.log("Finalizing interrupted user transcript:", pendingUserTranscriptRef.current);
      return finalizeUserTranscript();
    }
    
    return null;
  }, [finalizeUserTranscript]);

  const handleTurnComplete = useCallback(() => {
    console.log("Turn completed - pending user:", pendingUserTranscriptRef.current, "pending AI:", pendingAiTranscriptRef.current);
    
    const results = [];
    
    // First finalize AI transcript if exists
    if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
      console.log("Finalizing AI transcript on turn complete:", pendingAiTranscriptRef.current);
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

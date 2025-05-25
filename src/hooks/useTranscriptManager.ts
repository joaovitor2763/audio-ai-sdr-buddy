import { useRef, useCallback, useState } from 'react';
import { TranscriptionCleaner } from '@/services/transcriptionCleaner';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
}

interface TranscriptionSegment {
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

export const useTranscriptManager = (apiKey?: string) => {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  
  const cleanerRef = useRef<TranscriptionCleaner | null>(null);
  const addedEntriesRef = useRef<Set<string>>(new Set());
  const currentUserTextRef = useRef<string>("");
  const currentAiTextRef = useRef<string>("");

  // Generate a unique key for transcript entries to prevent duplicates
  const generateEntryKey = (speaker: string, text: string): string => {
    return `${speaker}:${text.trim()}`;
  };

  // Initialize cleaner when API key is available
  const initializeCleaner = useCallback(() => {
    if (apiKey && !cleanerRef.current) {
      cleanerRef.current = new TranscriptionCleaner(apiKey);
      console.log("✅ TranscriptionCleaner initialized with API key");
    }
  }, [apiKey]);

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return null;

    const entryKey = generateEntryKey(speaker, trimmedText);
    
    // Prevent duplicate entries
    if (addedEntriesRef.current.has(entryKey)) {
      console.log(`⚠️ Duplicate transcript entry prevented: ${speaker}: ${trimmedText}`);
      return null;
    }

    const newEntry = { speaker, text: trimmedText, timestamp: new Date() };
    
    setTranscript(prev => {
      console.log(`📝 Added to transcript: ${speaker}: ${trimmedText}`);
      return [...prev, newEntry];
    });

    // Track this entry to prevent duplicates
    addedEntriesRef.current.add(entryKey);
    
    // Clean up old entries from duplicate tracking (keep last 100)
    if (addedEntriesRef.current.size > 100) {
      const entriesArray = Array.from(addedEntriesRef.current);
      addedEntriesRef.current = new Set(entriesArray.slice(-50));
    }

    return newEntry;
  }, []);

  // Handle user transcript - add immediately
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("🎤 User transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length
    });
    
    // Skip empty content or pure noise
    if (!transcriptText.trim() || transcriptText.trim() === '<noise>') {
      return null;
    }

    // Clean the text
    const cleanedText = transcriptText.replace(/<noise>/g, '').replace(/\s+/g, ' ').trim();
    
    if (cleanedText && cleanedText.length >= 2) {
      // Check if this is different from what we already showed
      if (cleanedText !== currentUserTextRef.current) {
        console.log("✅ Adding user transcript immediately:", cleanedText);
        currentUserTextRef.current = cleanedText;
        return addToTranscript("Usuário", cleanedText);
      }
    }
    
    return null;
  }, [addToTranscript]);

  // Handle AI transcript - add immediately
  const handleAiTranscript = useCallback((text: string) => {
    console.log("🤖 AI text received:", text);
    
    const cleanedText = text.trim();
    
    if (cleanedText && cleanedText.length >= 3) {
      // Check if this is different from what we already showed
      if (cleanedText !== currentAiTextRef.current) {
        console.log("✅ Adding AI transcript immediately:", cleanedText);
        currentAiTextRef.current = cleanedText;
        return addToTranscript("Mari", cleanedText);
      }
    }
    
    return null;
  }, [addToTranscript]);

  // Simple interruption handler
  const handleInterruption = useCallback(async () => {
    console.log("⚠️ Handling transcript interruption");
    // Reset current text refs on interruption
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    return null;
  }, []);

  // Simple turn complete handler
  const handleTurnComplete = useCallback(async () => {
    console.log("🏁 Turn completed");
    // Reset refs for next turn
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    return [];
  }, []);

  // Simple generation complete handler
  const handleGenerationComplete = useCallback(() => {
    console.log("🎯 Generation completed");
    currentAiTextRef.current = "";
    return null;
  }, []);

  const clearTranscripts = useCallback(() => {
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    addedEntriesRef.current.clear();
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

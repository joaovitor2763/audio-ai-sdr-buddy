import { useRef, useCallback, useState } from 'react';
import { TranscriptionCleaner } from '@/services/transcriptionCleaner';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
  id: string;
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
  const userTextBufferRef = useRef<string>("");
  const userTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Generate a unique ID for transcript entries
  const generateEntryId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

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

    const newEntry = { 
      speaker, 
      text: trimmedText, 
      timestamp: new Date(),
      id: generateEntryId()
    };
    
    setTranscript(prev => {
      console.log(`📝 Added to transcript: ${speaker}: ${trimmedText}`);
      // Sort by timestamp to maintain chronological order
      const updated = [...prev, newEntry].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return updated;
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

  // Handle fragmented user transcript from Live API
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("🎤 User transcript fragment received:", {
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
    
    if (!cleanedText || cleanedText.length < 2) {
      return null;
    }

    // Add to buffer for fragmented messages
    userTextBufferRef.current += (userTextBufferRef.current ? ' ' : '') + cleanedText;

    // Clear existing timeout
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
    }

    // If this is marked as final, process immediately
    if (isFinal) {
      const finalText = userTextBufferRef.current.trim();
      if (finalText && finalText !== currentUserTextRef.current) {
        console.log("✅ Adding final user transcript:", finalText);
        currentUserTextRef.current = finalText;
        userTextBufferRef.current = "";
        return addToTranscript("Usuário", finalText);
      }
      userTextBufferRef.current = "";
      return null;
    }

    // For non-final fragments, wait for more content or timeout
    userTimeoutRef.current = setTimeout(() => {
      const bufferedText = userTextBufferRef.current.trim();
      if (bufferedText && bufferedText !== currentUserTextRef.current && bufferedText.length >= 3) {
        console.log("✅ Adding buffered user transcript after timeout:", bufferedText);
        currentUserTextRef.current = bufferedText;
        addToTranscript("Usuário", bufferedText);
      }
      userTextBufferRef.current = "";
    }, 1500); // Wait 1.5 seconds for more fragments

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

  // Handle interruption - clear user buffer
  const handleInterruption = useCallback(async () => {
    console.log("⚠️ Handling transcript interruption");
    
    // Clear user text buffer and timeout on interruption
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
      userTimeoutRef.current = null;
    }
    userTextBufferRef.current = "";
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    
    return null;
  }, []);

  // Handle turn completion
  const handleTurnComplete = useCallback(async () => {
    console.log("🏁 Turn completed");
    
    // Process any remaining buffered user text
    if (userTextBufferRef.current.trim()) {
      const finalText = userTextBufferRef.current.trim();
      if (finalText !== currentUserTextRef.current) {
        console.log("✅ Adding remaining buffered user text on turn complete:", finalText);
        addToTranscript("Usuário", finalText);
      }
    }
    
    // Clear timeouts and buffers
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
      userTimeoutRef.current = null;
    }
    userTextBufferRef.current = "";
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    
    return [];
  }, [addToTranscript]);

  // Handle generation completion
  const handleGenerationComplete = useCallback(() => {
    console.log("🎯 Generation completed");
    currentAiTextRef.current = "";
    return null;
  }, []);

  const clearTranscripts = useCallback(() => {
    // Clear all timeouts
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
      userTimeoutRef.current = null;
    }
    
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    userTextBufferRef.current = "";
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

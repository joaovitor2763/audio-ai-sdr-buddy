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
  
  const pendingUserSegmentsRef = useRef<TranscriptionSegment[]>([]);
  const pendingAiTranscriptRef = useRef<string>("");
  const isUserTurnRef = useRef(false);
  const isAiTurnRef = useRef(false);
  const lastUserTextRef = useRef<string>("");
  const cleanerRef = useRef<TranscriptionCleaner | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const addedEntriesRef = useRef<Set<string>>(new Set());

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

  const finalizeUserTranscript = useCallback(async () => {
    initializeCleaner();
    
    const segments = pendingUserSegmentsRef.current;
    const rawAccumulated = segments.map(s => s.text).join(' ');
    
    console.log("🔄 Finalizing user transcript with segments:", {
      segmentCount: segments.length,
      rawAccumulated,
      lastUserText: lastUserTextRef.current
    });
    
    if (!rawAccumulated.trim() || rawAccumulated.trim() === '<noise>') {
      console.log("❌ No meaningful content to finalize");
      return null;
    }

    let cleanedText = rawAccumulated;

    // Use Gemini for cleaning if available
    if (cleanerRef.current) {
      try {
        console.log("🤖 Using Gemini cleaner for transcription");
        cleanedText = await cleanerRef.current.cleanTranscription(
          segments,
          rawAccumulated,
          'user'
        );
        console.log("✅ Gemini cleaned text:", cleanedText);
      } catch (error) {
        console.error("❌ Error using Gemini cleaner, falling back to basic cleanup:", error);
        cleanedText = rawAccumulated.replace(/<noise>/g, '').replace(/\s+/g, ' ').trim();
      }
    } else {
      cleanedText = rawAccumulated.replace(/<noise>/g, '').replace(/\s+/g, ' ').trim();
    }
    
    if (cleanedText && cleanedText !== lastUserTextRef.current && cleanedText.length >= 2) {
      console.log("✅ Adding finalized user transcript:", cleanedText);
      const entry = addToTranscript("Usuário", cleanedText);
      lastUserTextRef.current = cleanedText;
      pendingUserSegmentsRef.current = [];
      isUserTurnRef.current = false;
      return entry;
    }
    
    console.log("❌ Cleaned text not added (duplicate or too short):", { cleanedText, lastUserText: lastUserTextRef.current });
    return null;
  }, [addToTranscript, initializeCleaner]);

  // Immediate user transcript processing (reduced debounce)
  const debouncedFinalizeUser = useCallback(() => {
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
    }
    
    processingTimeoutRef.current = setTimeout(() => {
      if (isUserTurnRef.current && pendingUserSegmentsRef.current.length > 0) {
        finalizeUserTranscript();
      }
    }, 500); // Reduced from 1000ms to 500ms for faster processing
  }, [finalizeUserTranscript]);

  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("🎤 Live API user transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length,
      currentTurn: isUserTurnRef.current ? 'user' : 'none'
    });
    
    // Skip empty content or pure noise
    if (!transcriptText.trim() || transcriptText.trim() === '<noise>') {
      return null;
    }

    // Start user turn if not already active
    if (!isUserTurnRef.current) {
      console.log("🟢 Starting user turn");
      isUserTurnRef.current = true;
      pendingUserSegmentsRef.current = [];
    }
    
    // Add segment to collection
    pendingUserSegmentsRef.current.push({
      text: transcriptText.trim(),
      timestamp: new Date(),
      isFinal: !!isFinal
    });
    
    console.log("📥 Added segment to collection, total segments:", pendingUserSegmentsRef.current.length);
    
    // If this is a final segment, trigger faster processing
    if (isFinal) {
      debouncedFinalizeUser();
    }
    
    return null;
  }, [debouncedFinalizeUser]);

  const handleAiTranscript = useCallback((text: string) => {
    console.log("🤖 AI text received:", text);
    
    // If we have pending user segments and AI is starting to speak, finalize user turn immediately
    if (isUserTurnRef.current && pendingUserSegmentsRef.current.length > 0) {
      console.log("🔄 AI speaking detected - finalizing pending user transcript immediately");
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      finalizeUserTranscript();
    }
    
    isAiTurnRef.current = true;
    pendingAiTranscriptRef.current += text;
  }, [finalizeUserTranscript]);

  const handleInterruption = useCallback(async () => {
    console.log("⚠️ Handling transcript interruption");
    
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    if (isUserTurnRef.current && pendingUserSegmentsRef.current.length > 0) {
      console.log("🔄 Finalizing interrupted user transcript");
      return await finalizeUserTranscript();
    }
    
    return null;
  }, [finalizeUserTranscript]);

  const handleTurnComplete = useCallback(async () => {
    console.log("🏁 Turn completed - pending segments:", pendingUserSegmentsRef.current.length, "pending AI:", pendingAiTranscriptRef.current);
    
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    const results = [];
    
    if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
      console.log("✅ Finalizing AI transcript on turn complete:", pendingAiTranscriptRef.current);
      results.push(addToTranscript("Mari", pendingAiTranscriptRef.current.trim()));
      pendingAiTranscriptRef.current = "";
      isAiTurnRef.current = false;
    }
    
    if (isUserTurnRef.current && pendingUserSegmentsRef.current.length > 0) {
      console.log("🔄 Finalizing user transcript on turn complete");
      const entry = await finalizeUserTranscript();
      if (entry) results.push(entry);
    }
    
    return results;
  }, [addToTranscript, finalizeUserTranscript]);

  const handleGenerationComplete = useCallback(() => {
    console.log("🎯 Generation completed");
    
    if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
      console.log("✅ Finalizing AI transcript on generation complete:", pendingAiTranscriptRef.current);
      const entry = addToTranscript("Mari", pendingAiTranscriptRef.current.trim());
      pendingAiTranscriptRef.current = "";
      isAiTurnRef.current = false;
      return entry;
    }
    return null;
  }, [addToTranscript]);

  const clearTranscripts = useCallback(() => {
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    pendingUserSegmentsRef.current = [];
    pendingAiTranscriptRef.current = "";
    lastUserTextRef.current = "";
    isUserTurnRef.current = false;
    isAiTurnRef.current = false;
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

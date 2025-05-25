
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
  const lastProcessedUserTextRef = useRef<string>("");
  const cleanerRef = useRef<TranscriptionCleaner | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastUserSegmentRef = useRef<string>("");

  // Initialize cleaner when API key is available
  const initializeCleaner = useCallback(() => {
    if (apiKey && !cleanerRef.current) {
      cleanerRef.current = new TranscriptionCleaner(apiKey);
      console.log("✅ TranscriptionCleaner initialized with API key");
    }
  }, [apiKey]);

  const addToTranscript = useCallback((speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => {
      // More robust duplicate prevention
      const isDuplicate = prev.some(entry => 
        entry.speaker === speaker && 
        entry.text.trim() === text.trim() && 
        (new Date().getTime() - entry.timestamp.getTime()) < 10000 // Within 10 seconds
      );
      
      if (isDuplicate) {
        console.log(`⚠️ Duplicate transcript entry prevented: ${speaker}: ${text}`);
        return prev;
      }
      
      console.log(`📝 Added to transcript: ${speaker}: ${text}`);
      return [...prev, newEntry];
    });
    return newEntry;
  }, []);

  const finalizeUserTranscript = useCallback(async () => {
    initializeCleaner();
    
    const segments = pendingUserSegmentsRef.current;
    const rawAccumulated = segments.map(s => s.text).join(' ');
    
    console.log("🔄 Finalizing user transcript with segments:", {
      segmentCount: segments.length,
      rawAccumulated,
      lastUserText: lastUserTextRef.current,
      lastProcessedUserText: lastProcessedUserTextRef.current
    });
    
    if (!rawAccumulated.trim() || rawAccumulated.trim() === '<noise>') {
      console.log("❌ No meaningful content to finalize");
      return null;
    }

    let cleanedText = rawAccumulated;

    // Use Gemini 2.0 Flash Lite for cleaning if available
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
      console.log("⚠️ No cleaner available, using basic cleanup");
      cleanedText = rawAccumulated.replace(/<noise>/g, '').replace(/\s+/g, ' ').trim();
    }
    
    // Enhanced duplicate prevention - check against both last user text and last processed text
    if (cleanedText && 
        cleanedText !== lastUserTextRef.current && 
        cleanedText !== lastProcessedUserTextRef.current &&
        cleanedText.length >= 2 &&
        !cleanedText.toLowerCase().includes('noise')) {
      
      console.log("✅ Adding finalized user transcript:", cleanedText);
      const entry = addToTranscript("Usuário", cleanedText);
      lastUserTextRef.current = cleanedText;
      lastProcessedUserTextRef.current = cleanedText;
      pendingUserSegmentsRef.current = [];
      isUserTurnRef.current = false;
      return entry;
    }
    
    console.log("❌ Cleaned text not added (duplicate or too short):", { 
      cleanedText, 
      lastUserText: lastUserTextRef.current,
      lastProcessedUserText: lastProcessedUserTextRef.current 
    });
    return null;
  }, [addToTranscript, initializeCleaner]);

  // Improved debounced user transcript processing with better deduplication
  const debouncedFinalizeUser = useCallback(() => {
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
    }
    
    processingTimeoutRef.current = setTimeout(() => {
      if (isUserTurnRef.current && pendingUserSegmentsRef.current.length > 0) {
        finalizeUserTranscript();
      }
    }, 1500); // Increased timeout for better segment collection
  }, [finalizeUserTranscript]);

  // Improved user transcript handling with better deduplication
  const handleUserTranscript = useCallback((transcriptText: string, isFinal?: boolean) => {
    console.log("🎤 Live API user transcript received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length,
      currentTurn: isUserTurnRef.current ? 'user' : 'none',
      lastSegment: lastUserSegmentRef.current
    });
    
    // Skip empty content, pure noise, or duplicate segments
    if (!transcriptText.trim() || 
        transcriptText.trim() === '<noise>' ||
        transcriptText.trim() === lastUserSegmentRef.current.trim()) {
      console.log("❌ Skipping duplicate or empty segment");
      return null;
    }

    // Start user turn if not already active
    if (!isUserTurnRef.current) {
      console.log("🟢 Starting user turn");
      isUserTurnRef.current = true;
      pendingUserSegmentsRef.current = [];
      lastUserSegmentRef.current = "";
    }
    
    // Check for near-duplicate segments in current collection
    const isDuplicateSegment = pendingUserSegmentsRef.current.some(segment => 
      segment.text.trim().toLowerCase() === transcriptText.trim().toLowerCase()
    );
    
    if (isDuplicateSegment) {
      console.log("❌ Skipping duplicate segment in current collection");
      return null;
    }
    
    // Add segment to collection
    pendingUserSegmentsRef.current.push({
      text: transcriptText.trim(),
      timestamp: new Date(),
      isFinal: !!isFinal
    });
    
    lastUserSegmentRef.current = transcriptText.trim();
    
    console.log("📥 Added segment to collection, total segments:", pendingUserSegmentsRef.current.length);
    
    // If this is a final segment, trigger debounced processing
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
    
    // Clear any pending timeouts
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    // Finalize any pending user transcript on interruption
    if (isUserTurnRef.current && pendingUserSegmentsRef.current.length > 0) {
      console.log("🔄 Finalizing interrupted user transcript");
      return await finalizeUserTranscript();
    }
    
    return null;
  }, [finalizeUserTranscript]);

  const handleTurnComplete = useCallback(async () => {
    console.log("🏁 Turn completed - pending segments:", pendingUserSegmentsRef.current.length, "pending AI:", pendingAiTranscriptRef.current);
    
    // Clear any pending timeouts
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    const results = [];
    
    // First finalize AI transcript if exists
    if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
      console.log("✅ Finalizing AI transcript on turn complete:", pendingAiTranscriptRef.current);
      results.push(addToTranscript("Mari", pendingAiTranscriptRef.current.trim()));
      pendingAiTranscriptRef.current = "";
      isAiTurnRef.current = false;
    }
    
    // Then finalize user transcript if exists
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
    // Clear any pending timeouts
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    pendingUserSegmentsRef.current = [];
    pendingAiTranscriptRef.current = "";
    lastUserTextRef.current = "";
    lastProcessedUserTextRef.current = "";
    lastUserSegmentRef.current = "";
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


import { useRef, useCallback, useState } from 'react';
import { TranscriptionCleaner } from '@/services/transcriptionCleaner';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
  id: string;
  processingId?: string; // For tracking pending entries
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
  const pendingUserSegmentsRef = useRef<TranscriptionSegment[]>([]);
  const processingUserTextRef = useRef<boolean>(false);

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

  const addToTranscript = useCallback((speaker: string, text: string, processingId?: string) => {
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
      id: generateEntryId(),
      processingId
    };
    
    setTranscript(prev => {
      console.log(`📝 Added to transcript: ${speaker}: ${trimmedText}`);
      
      // If this is replacing a processing entry, remove the old one first
      let filtered = prev;
      if (processingId) {
        filtered = prev.filter(entry => entry.processingId !== processingId);
      }
      
      // Add new entry and sort by timestamp to maintain chronological order
      const updated = [...filtered, newEntry].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
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

  // Process user text with AI cleaner
  const processUserTextWithAI = useCallback(async (segments: TranscriptionSegment[], accumulated: string): Promise<string> => {
    if (!cleanerRef.current) {
      initializeCleaner();
      if (!cleanerRef.current) {
        // Fallback to basic processing
        const combined = accumulated + " " + segments.map(s => s.text).join(" ");
        return combined.replace(/<noise>/g, '').replace(/\s+/g, ' ').trim();
      }
    }

    try {
      console.log("🧠 Processing user text with AI cleaner");
      const cleanedText = await cleanerRef.current.cleanTranscription(segments, accumulated, 'user');
      console.log("✅ AI cleaned user text:", cleanedText);
      return cleanedText;
    } catch (error) {
      console.error("❌ Error processing user text with AI:", error);
      // Fallback to basic processing
      const combined = accumulated + " " + segments.map(s => s.text).join(" ");
      return combined.replace(/<noise>/g, '').replace(/\s+/g, ' ').trim();
    }
  }, [initializeCleaner]);

  // Handle fragmented user transcript from Live API
  const handleUserTranscript = useCallback(async (transcriptText: string, isFinal?: boolean) => {
    console.log("🎤 User transcript fragment received:", {
      text: transcriptText,
      isFinal: isFinal,
      length: transcriptText.length
    });
    
    // Skip empty content or pure noise
    if (!transcriptText.trim() || transcriptText.trim() === '<noise>') {
      return null;
    }

    // Create a segment for this fragment
    const segment: TranscriptionSegment = {
      text: transcriptText,
      timestamp: new Date(),
      isFinal: isFinal || false
    };

    // Add to pending segments
    pendingUserSegmentsRef.current.push(segment);

    // Clear existing timeout
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
    }

    // If this is marked as final or we have substantial content, process immediately
    if (isFinal || pendingUserSegmentsRef.current.length >= 3) {
      if (!processingUserTextRef.current) {
        processingUserTextRef.current = true;
        
        try {
          // Process with AI cleaner
          const cleanedText = await processUserTextWithAI(
            pendingUserSegmentsRef.current,
            userTextBufferRef.current
          );

          if (cleanedText && cleanedText.length >= 2 && cleanedText !== currentUserTextRef.current) {
            console.log("✅ Adding processed user transcript:", cleanedText);
            currentUserTextRef.current = cleanedText;
            addToTranscript("Usuário", cleanedText);
          }

          // Clear processed segments and buffer
          pendingUserSegmentsRef.current = [];
          userTextBufferRef.current = "";
        } catch (error) {
          console.error("❌ Error processing user transcript:", error);
        } finally {
          processingUserTextRef.current = false;
        }
      }
      return null;
    }

    // For non-final fragments, wait for more content or timeout
    userTimeoutRef.current = setTimeout(async () => {
      if (!processingUserTextRef.current && pendingUserSegmentsRef.current.length > 0) {
        processingUserTextRef.current = true;
        
        try {
          const cleanedText = await processUserTextWithAI(
            pendingUserSegmentsRef.current,
            userTextBufferRef.current
          );

          if (cleanedText && cleanedText.length >= 2 && cleanedText !== currentUserTextRef.current) {
            console.log("✅ Adding timeout-processed user transcript:", cleanedText);
            currentUserTextRef.current = cleanedText;
            addToTranscript("Usuário", cleanedText);
          }

          // Clear processed segments and buffer
          pendingUserSegmentsRef.current = [];
          userTextBufferRef.current = "";
        } catch (error) {
          console.error("❌ Error processing user transcript on timeout:", error);
        } finally {
          processingUserTextRef.current = false;
        }
      }
    }, 2000); // Wait 2 seconds for more fragments

    return null;
  }, [addToTranscript, processUserTextWithAI]);

  // Handle AI transcript - add immediately with timestamp ordering
  const handleAiTranscript = useCallback((text: string) => {
    console.log("🤖 AI text received:", text);
    
    const cleanedText = text.trim();
    
    if (cleanedText && cleanedText.length >= 3) {
      // Check if this is different from what we already showed
      if (cleanedText !== currentAiTextRef.current) {
        console.log("✅ Adding AI transcript immediately:", cleanedText);
        currentAiTextRef.current = cleanedText;
        
        // Add with current timestamp to ensure proper ordering
        return addToTranscript("Mari", cleanedText);
      }
    }
    
    return null;
  }, [addToTranscript]);

  // Handle interruption - clear user buffer and processing
  const handleInterruption = useCallback(async () => {
    console.log("⚠️ Handling transcript interruption");
    
    // Clear user text buffer and timeout on interruption
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
      userTimeoutRef.current = null;
    }
    
    // Clear all user processing state
    userTextBufferRef.current = "";
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    pendingUserSegmentsRef.current = [];
    processingUserTextRef.current = false;
    
    return null;
  }, []);

  // Handle turn completion
  const handleTurnComplete = useCallback(async () => {
    console.log("🏁 Turn completed");
    
    // Process any remaining buffered user segments
    if (pendingUserSegmentsRef.current.length > 0 && !processingUserTextRef.current) {
      processingUserTextRef.current = true;
      
      try {
        const cleanedText = await processUserTextWithAI(
          pendingUserSegmentsRef.current,
          userTextBufferRef.current
        );

        if (cleanedText && cleanedText !== currentUserTextRef.current) {
          console.log("✅ Adding remaining user text on turn complete:", cleanedText);
          addToTranscript("Usuário", cleanedText);
        }
      } catch (error) {
        console.error("❌ Error processing remaining user text:", error);
      } finally {
        processingUserTextRef.current = false;
      }
    }
    
    // Clear timeouts and buffers
    if (userTimeoutRef.current) {
      clearTimeout(userTimeoutRef.current);
      userTimeoutRef.current = null;
    }
    
    // Clear processing state
    userTextBufferRef.current = "";
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    pendingUserSegmentsRef.current = [];
    processingUserTextRef.current = false;
    
    return [];
  }, [addToTranscript, processUserTextWithAI]);

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
    
    // Reset all state
    currentUserTextRef.current = "";
    currentAiTextRef.current = "";
    userTextBufferRef.current = "";
    pendingUserSegmentsRef.current = [];
    processingUserTextRef.current = false;
    addedEntriesRef.current.clear();
    setTranscript([]);
  }, []);

  // Initialize cleaner when component mounts and API key is available
  React.useEffect(() => {
    if (apiKey) {
      initializeCleaner();
    }
  }, [apiKey, initializeCleaner]);

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

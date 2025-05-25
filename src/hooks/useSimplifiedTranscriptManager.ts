
import { useRef, useCallback, useState } from 'react';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
  turnId: string;
}

interface ConversationTurn {
  turnId: string;
  userFragments: string[];
  userTranscript: string;
  aiTranscript: string;
  startTime: Date;
  endTime?: Date;
  isComplete: boolean;
}

export const useSimplifiedTranscriptManager = () => {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  
  const currentTurnRef = useRef<ConversationTurn | null>(null);
  const turnCounterRef = useRef(0);
  const pendingAiTranscriptRef = useRef<string>("");
  const lastUserEntryRef = useRef<string>("");
  const lastAiEntryRef = useRef<string>("");
  const userFragmentBufferRef = useRef<string[]>([]);

  const generateTurnId = useCallback(() => {
    turnCounterRef.current += 1;
    return `turn-${turnCounterRef.current}-${Date.now()}`;
  }, []);

  // Improved text cleaning function
  const cleanTranscriptText = useCallback((text: string) => {
    if (!text) return "";
    
    // Remove noise markers and clean up the text
    let cleaned = text
      .replace(/<noise>/gi, "")
      .replace(/\[noise\]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    
    // Filter out very short or meaningless content
    if (cleaned.length < 2 || cleaned === "." || cleaned === "," || cleaned === "?") {
      return "";
    }
    
    return cleaned;
  }, []);

  const addToTranscript = useCallback((speaker: string, text: string, turnId: string) => {
    const cleanedText = cleanTranscriptText(text);
    if (!cleanedText) return null;

    // Skip if the new text is exactly the same as the last entry from this speaker
    if (speaker === 'Usuário' && cleanedText === lastUserEntryRef.current) {
      console.log(`⚠️ Skipping duplicate user entry: "${cleanedText}"`);
      return null;
    }
    if (speaker === 'Mari' && cleanedText === lastAiEntryRef.current) {
      console.log(`⚠️ Skipping duplicate AI entry: "${cleanedText}"`);
      return null;
    }
    
    const newEntry: TranscriptEntry = { 
      speaker, 
      text: cleanedText, 
      timestamp: new Date(),
      turnId
    };
    
    console.log(`📝 Adding to transcript: ${speaker}: ${cleanedText} (Turn: ${turnId})`);
    
    setTranscript(prev => {
      // More sophisticated duplicate detection
      const recentEntries = prev.slice(-5);
      const isDuplicate = recentEntries.some(entry => {
        const timeDiff = Date.now() - entry.timestamp.getTime();
        const isSameSpeaker = entry.speaker === speaker;
        const isSimilarText = entry.text === cleanedText || 
                             (entry.text.includes(cleanedText) && cleanedText.length > 5) ||
                             (cleanedText.includes(entry.text) && entry.text.length > 5);
        
        return isSameSpeaker && isSimilarText && timeDiff < 10000; // 10 second window
      });
      
      if (isDuplicate) {
        console.log(`⚠️ Duplicate prevented: ${speaker}: ${cleanedText}`);
        return prev;
      }

      return [...prev, newEntry];
    });

    if (speaker === 'Usuário') {
      lastUserEntryRef.current = cleanedText;
    } else if (speaker === 'Mari') {
      lastAiEntryRef.current = cleanedText;
    }

    return newEntry;
  }, [cleanTranscriptText]);

  const startNewTurn = useCallback(() => {
    const turnId = generateTurnId();
    currentTurnRef.current = {
      turnId,
      userFragments: [],
      userTranscript: "",
      aiTranscript: "",
      startTime: new Date(),
      isComplete: false
    };
    
    // Reset fragment buffer for new turn
    userFragmentBufferRef.current = [];
    
    console.log(`🔄 Started new turn: ${turnId}`);
    return turnId;
  }, [generateTurnId]);

  const accumulateUserFragment = useCallback((fragment: string) => {
    const cleanedFragment = cleanTranscriptText(fragment);
    if (!cleanedFragment) return;

    console.log(`📥 Accumulating user fragment: "${cleanedFragment}"`);
    
    // Add to fragment buffer
    userFragmentBufferRef.current.push(cleanedFragment);
    
    // Update current turn if exists
    if (currentTurnRef.current) {
      currentTurnRef.current.userFragments = [...userFragmentBufferRef.current];
      // Reconstruct full transcript from fragments
      currentTurnRef.current.userTranscript = userFragmentBufferRef.current.join(' ').trim();
    }
    
    console.log(`📊 Fragment buffer now has ${userFragmentBufferRef.current.length} fragments: [${userFragmentBufferRef.current.join(', ')}]`);
  }, [cleanTranscriptText]);

  const handleUserTranscript = useCallback((transcriptText: string) => {
    const cleanedText = cleanTranscriptText(transcriptText);
    if (!cleanedText) {
      console.log(`🎤 User transcript filtered out: "${transcriptText}"`);
      return null;
    }

    console.log(`🎤 User fragment received: "${cleanedText}" (Length: ${cleanedText.length})`);

    // If no current turn, start one
    if (!currentTurnRef.current) {
      startNewTurn();
    }
    
    // Accumulate this fragment instead of treating it as complete transcript
    accumulateUserFragment(cleanedText);
    
    return null; // Don't add to transcript yet, wait for turn completion
  }, [cleanTranscriptText, startNewTurn, accumulateUserFragment]);

  const handleAiTranscript = useCallback((text: string) => {
    const cleanedText = cleanTranscriptText(text);
    if (!cleanedText) return;

    console.log(`🤖 AI transcript received: "${cleanedText}"`);

    // For AI responses, we can accumulate as they come in
    if (pendingAiTranscriptRef.current && !pendingAiTranscriptRef.current.includes(cleanedText)) {
      pendingAiTranscriptRef.current += " " + cleanedText;
    } else if (!pendingAiTranscriptRef.current) {
      pendingAiTranscriptRef.current = cleanedText;
    }
    
    if (currentTurnRef.current) {
      currentTurnRef.current.aiTranscript = pendingAiTranscriptRef.current;
    }
  }, [cleanTranscriptText]);

  const handleGenerationComplete = useCallback(() => {
    console.log(`🎯 Generation complete`);
    
    if (!currentTurnRef.current) return null;
    
    // Add AI transcript when generation is complete
    if (pendingAiTranscriptRef.current.trim()) {
      const aiEntry = addToTranscript(
        "Mari", 
        pendingAiTranscriptRef.current.trim(),
        currentTurnRef.current.turnId
      );
      pendingAiTranscriptRef.current = "";
      return aiEntry;
    }
    
    return null;
  }, [addToTranscript]);

  const handleTurnComplete = useCallback(() => {
    console.log(`🏁 Turn complete`);
    
    if (!currentTurnRef.current) return [];
    
    const results: TranscriptEntry[] = [];
    
    console.log(`📊 Turn completion - Fragment buffer: [${userFragmentBufferRef.current.join(', ')}]`);
    console.log(`📊 Current turn user transcript: "${currentTurnRef.current.userTranscript}"`);
    
    // FIRST: Add user transcript if exists (ensure proper chronological order)
    if (userFragmentBufferRef.current.length > 0) {
      const fullUserTranscript = userFragmentBufferRef.current.join(' ').trim();
      console.log(`✅ Finalizing complete user transcript: "${fullUserTranscript}"`);
      
      if (fullUserTranscript && fullUserTranscript !== lastUserEntryRef.current) {
        const userEntry = addToTranscript(
          "Usuário", 
          fullUserTranscript,
          currentTurnRef.current.turnId
        );
        if (userEntry) {
          // Adjust timestamp to be slightly before AI response for proper ordering
          userEntry.timestamp = new Date(Date.now() - 1000);
          results.push(userEntry);
        }
      }
      
      // Clear fragment buffer
      userFragmentBufferRef.current = [];
    }
    
    // Mark turn as complete
    currentTurnRef.current.isComplete = true;
    currentTurnRef.current.endTime = new Date();
    
    // Reset for next turn
    currentTurnRef.current = null;
    
    console.log(`✅ Turn completed, added ${results.length} entries`);
    return results;
  }, [addToTranscript]);

  const handleInterruption = useCallback(() => {
    console.log(`⚠️ Handling interruption`);
    
    if (!currentTurnRef.current) return null;
    
    // Process any accumulated user fragments immediately
    if (userFragmentBufferRef.current.length > 0) {
      const fullUserTranscript = userFragmentBufferRef.current.join(' ').trim();
      console.log(`🔄 Finalizing interrupted user transcript: "${fullUserTranscript}"`);
      
      if (fullUserTranscript) {
        const userEntry = addToTranscript(
          "Usuário", 
          fullUserTranscript,
          currentTurnRef.current.turnId
        );
        
        // Clear buffers
        userFragmentBufferRef.current = [];
        
        // Reset turn state
        currentTurnRef.current = null;
        
        return userEntry;
      }
    }
    
    return null;
  }, [addToTranscript]);

  const clearTranscripts = useCallback(() => {
    console.log(`🧹 Clearing all transcripts`);
    
    pendingAiTranscriptRef.current = "";
    userFragmentBufferRef.current = [];
    currentTurnRef.current = null;
    turnCounterRef.current = 0;
    lastUserEntryRef.current = "";
    lastAiEntryRef.current = "";
    setTranscript([]);
  }, []);

  // Get current turn info for debugging
  const getCurrentTurnInfo = useCallback(() => {
    return {
      currentTurn: currentTurnRef.current,
      fragmentBuffer: userFragmentBufferRef.current,
      pendingAi: pendingAiTranscriptRef.current,
      fragmentCount: userFragmentBufferRef.current.length
    };
  }, []);

  return {
    transcript,
    addToTranscript,
    handleUserTranscript,
    handleAiTranscript,
    handleGenerationComplete,
    handleTurnComplete,
    handleInterruption,
    clearTranscripts,
    getCurrentTurnInfo
  };
};

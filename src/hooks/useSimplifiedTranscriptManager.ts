
import { useRef, useCallback, useState } from 'react';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
  turnId: string;
}

interface ConversationTurn {
  turnId: string;
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
  const pendingUserTranscriptRef = useRef<string>("");
  const pendingAiTranscriptRef = useRef<string>("");

  const generateTurnId = useCallback(() => {
    turnCounterRef.current += 1;
    return `turn-${turnCounterRef.current}-${Date.now()}`;
  }, []);

  const addToTranscript = useCallback((speaker: string, text: string, turnId: string) => {
    if (!text.trim()) return null;
    
    const newEntry: TranscriptEntry = { 
      speaker, 
      text: text.trim(), 
      timestamp: new Date(),
      turnId
    };
    
    console.log(`📝 Adding to transcript: ${speaker}: ${text} (Turn: ${turnId})`);
    
    setTranscript(prev => {
      // Check for exact duplicates in the last few entries
      const recentEntries = prev.slice(-3);
      const isDuplicate = recentEntries.some(entry => 
        entry.speaker === speaker && 
        entry.text === text.trim() &&
        (Date.now() - entry.timestamp.getTime()) < 5000
      );
      
      if (isDuplicate) {
        console.log(`⚠️ Duplicate prevented: ${speaker}: ${text}`);
        return prev;
      }
      
      return [...prev, newEntry];
    });
    
    return newEntry;
  }, []);

  const startNewTurn = useCallback(() => {
    const turnId = generateTurnId();
    currentTurnRef.current = {
      turnId,
      userTranscript: "",
      aiTranscript: "",
      startTime: new Date(),
      isComplete: false
    };
    
    console.log(`🔄 Started new turn: ${turnId}`);
    return turnId;
  }, [generateTurnId]);

  const handleUserTranscript = useCallback((transcriptText: string) => {
    if (!transcriptText.trim() || transcriptText.trim() === '<noise>') {
      return null;
    }

    console.log(`🎤 User transcript received: "${transcriptText}"`);
    
    // If no current turn, start one
    if (!currentTurnRef.current) {
      startNewTurn();
    }
    
    // Accumulate user transcript (Live API sends incremental updates)
    pendingUserTranscriptRef.current = transcriptText.trim();
    
    if (currentTurnRef.current) {
      currentTurnRef.current.userTranscript = transcriptText.trim();
    }
    
    return null; // Don't add to transcript yet, wait for turn completion
  }, [startNewTurn]);

  const handleAiTranscript = useCallback((text: string) => {
    if (!text.trim()) return;
    
    console.log(`🤖 AI transcript received: "${text}"`);
    
    // Accumulate AI transcript
    pendingAiTranscriptRef.current += text;
    
    if (currentTurnRef.current) {
      currentTurnRef.current.aiTranscript += text;
    }
  }, []);

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
    
    // Add user transcript if exists
    if (pendingUserTranscriptRef.current.trim()) {
      const userEntry = addToTranscript(
        "Usuário", 
        pendingUserTranscriptRef.current.trim(),
        currentTurnRef.current.turnId
      );
      if (userEntry) results.push(userEntry);
      pendingUserTranscriptRef.current = "";
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
    
    // Process any pending user transcript immediately
    if (pendingUserTranscriptRef.current.trim()) {
      const userEntry = addToTranscript(
        "Usuário", 
        pendingUserTranscriptRef.current.trim(),
        currentTurnRef.current.turnId
      );
      pendingUserTranscriptRef.current = "";
      
      // Reset turn state
      currentTurnRef.current = null;
      
      return userEntry;
    }
    
    return null;
  }, [addToTranscript]);

  const clearTranscripts = useCallback(() => {
    console.log(`🧹 Clearing all transcripts`);
    
    pendingUserTranscriptRef.current = "";
    pendingAiTranscriptRef.current = "";
    currentTurnRef.current = null;
    turnCounterRef.current = 0;
    setTranscript([]);
  }, []);

  // Get current turn info for debugging
  const getCurrentTurnInfo = useCallback(() => {
    return {
      currentTurn: currentTurnRef.current,
      pendingUser: pendingUserTranscriptRef.current,
      pendingAi: pendingAiTranscriptRef.current
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

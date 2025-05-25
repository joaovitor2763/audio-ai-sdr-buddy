
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
    
    return newEntry;
  }, [cleanTranscriptText]);

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
    const cleanedText = cleanTranscriptText(transcriptText);
    if (!cleanedText) {
      console.log(`🎤 User transcript filtered out: "${transcriptText}"`);
      return null;
    }

    console.log(`🎤 User transcript received: "${cleanedText}"`);
    
    // If no current turn, start one
    if (!currentTurnRef.current) {
      startNewTurn();
    }
    
    // For Live API, we get the complete transcript, not incremental
    pendingUserTranscriptRef.current = cleanedText;
    
    if (currentTurnRef.current) {
      currentTurnRef.current.userTranscript = cleanedText;
    }
    
    return null; // Don't add to transcript yet, wait for turn completion
  }, [cleanTranscriptText, startNewTurn]);

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

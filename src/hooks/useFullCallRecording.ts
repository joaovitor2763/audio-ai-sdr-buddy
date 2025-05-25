
import { useRef, useCallback, useState } from 'react';
import { GoogleGenAI } from '@google/genai';

interface CallRecordingEntry {
  audio: ArrayBuffer;
  timestamp: Date;
  source: 'user' | 'ai';
}

interface TranscribedSegment {
  speaker: 'user' | 'ai';
  text: string;
  startTime: number;
  endTime: number;
  timestamp: Date;
}

export const useFullCallRecording = (apiKey: string) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingTranscription, setIsProcessingTranscription] = useState(false);
  const audioChunksRef = useRef<CallRecordingEntry[]>([]);
  const callStartTimeRef = useRef<Date | null>(null);

  const startRecording = useCallback(() => {
    console.log("🎙️ Starting full call recording");
    audioChunksRef.current = [];
    callStartTimeRef.current = new Date();
    setIsRecording(true);
  }, []);

  const addAudioChunk = useCallback((audioData: ArrayBuffer, source: 'user' | 'ai') => {
    if (!isRecording) return;
    
    audioChunksRef.current.push({
      audio: audioData,
      timestamp: new Date(),
      source
    });
    
    console.log(`📼 Added ${source} audio chunk, total chunks: ${audioChunksRef.current.length}`);
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    console.log("⏹️ Stopping call recording");
    setIsRecording(false);
  }, []);

  const combineAudioChunks = useCallback((): ArrayBuffer => {
    if (audioChunksRef.current.length === 0) {
      return new ArrayBuffer(0);
    }

    // Calculate total size
    const totalSize = audioChunksRef.current.reduce((sum, chunk) => sum + chunk.audio.byteLength, 0);
    
    // Combine all chunks
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const chunk of audioChunksRef.current) {
      combined.set(new Uint8Array(chunk.audio), offset);
      offset += chunk.audio.byteLength;
    }
    
    console.log(`🔄 Combined ${audioChunksRef.current.length} audio chunks into ${totalSize} bytes`);
    return combined.buffer;
  }, []);

  const transcribeFullCall = useCallback(async (): Promise<TranscribedSegment[]> => {
    if (!apiKey) {
      throw new Error('API key required for transcription');
    }

    setIsProcessingTranscription(true);
    
    try {
      const combinedAudio = combineAudioChunks();
      
      if (combinedAudio.byteLength === 0) {
        console.warn("⚠️ No audio data to transcribe");
        return [];
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Convert to base64 for API
      const base64Audio = btoa(String.fromCharCode(...new Uint8Array(combinedAudio)));
      
      console.log("🤖 Starting full call transcription with Gemini 2.5 Flash");
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        config: {
          responseMimeType: 'application/json',
          systemInstruction: [
            {
              text: `Você é um especialista em transcrição de áudio de chamadas em português brasileiro.

TAREFA: Transcreva este áudio de uma call de qualificação comercial com identificação de falantes e timestamps.

INSTRUÇÕES ESPECÍFICAS:
1. Identifique claramente os dois falantes: "Usuário" (lead/cliente) e "Mari" (SDR da G4 Educação)
2. Forneça transcrição COMPLETA e PRECISA de cada fala
3. Includa timestamps relativos em segundos desde o início da call
4. Use SOMENTE português brasileiro na transcrição
5. Corrija erros óbvios de pronúncia mantendo o sentido original
6. IGNORE completamente qualquer texto em árabe, chinês ou outros idiomas não-latinos
7. Se houver ruído ou áudio ininteligível, marque como [inaudível]

FORMATO DE SAÍDA (JSON):
{
  "segments": [
    {
      "speaker": "user" | "ai",
      "text": "transcrição da fala",
      "startTime": segundos_inicio,
      "endTime": segundos_fim
    }
  ]
}

EXEMPLO:
{
  "segments": [
    {
      "speaker": "ai",
      "text": "Olá! Eu sou a Mari, da G4 Educação. Tudo bem?",
      "startTime": 0,
      "endTime": 3.5
    },
    {
      "speaker": "user", 
      "text": "Olá Mari, tudo bem sim. Meu nome é João Vítor.",
      "startTime": 4.0,
      "endTime": 7.2
    }
  ]
}

Transcreva o áudio fornecido seguindo essas diretrizes:`
            }
          ]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: base64Audio
                }
              },
              {
                text: 'Transcreva este áudio de call de qualificação comercial com speaker labels e timestamps precisos em português brasileiro.'
              }
            ]
          }
        ]
      });

      const responseText = response.text || '';
      console.log("📝 Raw transcription response:", responseText);

      // Parse the JSON response
      const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const transcriptionData = JSON.parse(cleanedResponse);
      
      // Convert to our format
      const segments: TranscribedSegment[] = transcriptionData.segments.map((segment: any) => ({
        speaker: segment.speaker === 'user' ? 'user' : 'ai',
        text: segment.text,
        startTime: segment.startTime,
        endTime: segment.endTime,
        timestamp: new Date(callStartTimeRef.current!.getTime() + (segment.startTime * 1000))
      }));

      console.log(`✅ Transcription completed: ${segments.length} segments`);
      return segments;

    } catch (error) {
      console.error('❌ Error transcribing full call:', error);
      throw error;
    } finally {
      setIsProcessingTranscription(false);
    }
  }, [apiKey, combineAudioChunks]);

  const resetRecording = useCallback(() => {
    audioChunksRef.current = [];
    callStartTimeRef.current = null;
    setIsRecording(false);
    setIsProcessingTranscription(false);
  }, []);

  return {
    isRecording,
    isProcessingTranscription,
    startRecording,
    stopRecording,
    addAudioChunk,
    transcribeFullCall,
    resetRecording,
    hasAudioData: audioChunksRef.current.length > 0
  };
};

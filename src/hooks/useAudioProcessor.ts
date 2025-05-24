
import { useRef, useCallback } from 'react';
import { Session } from '@google/genai';

export const useAudioProcessor = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const startAudioProcessing = useCallback(async (session: Session, onAudioLevel: (level: number) => void) => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      
      streamRef.current = stream;
      
      // Create AudioContext
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      
      // Load AudioWorklet
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      
      // Create AudioWorklet node
      audioWorkletRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      // Connect audio stream to worklet
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(audioWorkletRef.current);
      
      // Handle audio data from worklet
      audioWorkletRef.current.port.onmessage = async (event) => {
        if (event.data.type === 'audioData') {
          const pcmBuffer = event.data.data;
          
          try {
            // Convert ArrayBuffer to base64
            const uint8Array = new Uint8Array(pcmBuffer);
            const base64Data = btoa(String.fromCharCode(...uint8Array));
            
            // Send to Gemini Live API
            await session.sendRealtimeInput({
              audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=16000'
              }
            });
            
            // Calculate audio level for visualization
            const floatArray = new Float32Array(pcmBuffer);
            const rms = Math.sqrt(floatArray.reduce((sum, sample) => sum + sample * sample, 0) / floatArray.length);
            onAudioLevel(rms * 100);
            
          } catch (error) {
            console.error('Error sending audio data:', error);
          }
        }
      };
      
      return stream;
    } catch (error) {
      console.error('Error starting audio processing:', error);
      throw error;
    }
  }, []);
  
  const stopAudioProcessing = useCallback(() => {
    if (audioWorkletRef.current) {
      audioWorkletRef.current.disconnect();
      audioWorkletRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);
  
  const toggleMute = useCallback((isMuted: boolean) => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, []);
  
  return {
    startAudioProcessing,
    stopAudioProcessing,
    toggleMute
  };
};

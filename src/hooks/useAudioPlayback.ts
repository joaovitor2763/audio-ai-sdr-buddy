
import { useRef, useCallback } from 'react';

export const useAudioPlayback = () => {
  const audioContextPlaybackRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const decode = (base64Data: string): ArrayBuffer => {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const decodeAudioData = async (
    arrayBuffer: ArrayBuffer,
    audioContext: AudioContext,
    sampleRate: number,
    channels: number
  ): Promise<AudioBuffer> => {
    const numSamples = arrayBuffer.byteLength / 2;
    const audioBuffer = audioContext.createBuffer(channels, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    const dataView = new DataView(arrayBuffer);
    for (let i = 0; i < numSamples; i++) {
      const sample = dataView.getInt16(i * 2, true);
      channelData[i] = sample / 32768.0;
    }
    
    return audioBuffer;
  };

  const initializeAudioContext = useCallback(async () => {
    if (!audioContextPlaybackRef.current) {
      console.log("Creating new AudioContext for playback");
      audioContextPlaybackRef.current = new AudioContext({ sampleRate: 24000 });
    }

    if (audioContextPlaybackRef.current.state === 'suspended') {
      console.log("Resuming suspended AudioContext");
      await audioContextPlaybackRef.current.resume();
    }

    nextStartTimeRef.current = audioContextPlaybackRef.current.currentTime;
    audioSourcesRef.current.clear();
  }, []);

  const handleAudioMessage = useCallback(async (inlineData: any) => {
    try {
      console.log("Processing audio chunk, mime:", inlineData.mimeType, "size:", inlineData.data?.length);
      
      if (!audioContextPlaybackRef.current) {
        await initializeAudioContext();
      }

      if (audioContextPlaybackRef.current!.state === 'suspended') {
        await audioContextPlaybackRef.current!.resume();
      }

      const audioBuffer = await decodeAudioData(
        decode(inlineData.data),
        audioContextPlaybackRef.current!,
        24000,
        1
      );

      nextStartTimeRef.current = Math.max(
        nextStartTimeRef.current,
        audioContextPlaybackRef.current!.currentTime
      );

      const source = audioContextPlaybackRef.current!.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextPlaybackRef.current!.destination);
      
      source.addEventListener('ended', () => {
        audioSourcesRef.current.delete(source);
        console.log(`Audio source ended, remaining sources: ${audioSourcesRef.current.size}`);
      });

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
      audioSourcesRef.current.add(source);
      
      console.log(`Audio scheduled to start at ${nextStartTimeRef.current}, duration: ${audioBuffer.duration}s`);
      
    } catch (error) {
      console.error("Error processing audio:", error);
    }
  }, [initializeAudioContext]);

  const stopAllAudio = useCallback(() => {
    for (const source of audioSourcesRef.current.values()) {
      try {
        source.stop();
      } catch (e) {
        console.warn("Error stopping audio source:", e);
      }
      audioSourcesRef.current.delete(source);
    }
    nextStartTimeRef.current = 0;
  }, []);

  const resetAudio = useCallback(() => {
    stopAllAudio();
    nextStartTimeRef.current = 0;
  }, [stopAllAudio]);

  return {
    initializeAudioContext,
    handleAudioMessage,
    stopAllAudio,
    resetAudio
  };
};


class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1024; // Smaller buffer for better responsiveness
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const inputChannel = input[0];
      
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex] = inputChannel[i];
        this.bufferIndex++;
        
        if (this.bufferIndex >= this.bufferSize) {
          // Convert float32 to 16-bit PCM as required by Live API
          // Raw, little-endian, 16-bit PCM format
          const pcmBuffer = new ArrayBuffer(this.bufferSize * 2);
          const pcmView = new DataView(pcmBuffer);
          
          for (let j = 0; j < this.bufferSize; j++) {
            // Clamp sample to [-1, 1] and convert to 16-bit PCM
            const sample = Math.max(-1, Math.min(1, this.buffer[j]));
            const pcmSample = Math.round(sample * 32767);
            pcmView.setInt16(j * 2, pcmSample, true); // true for little-endian
          }
          
          // Send PCM data to main thread with proper format
          this.port.postMessage({
            type: 'audioData',
            data: pcmBuffer
          });
          
          this.bufferIndex = 0;
        }
      }
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);


class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1024;
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
          // Convert float32 to 16-bit PCM
          const pcmBuffer = new ArrayBuffer(this.bufferSize * 2);
          const pcmView = new DataView(pcmBuffer);
          
          for (let j = 0; j < this.bufferSize; j++) {
            const sample = Math.max(-1, Math.min(1, this.buffer[j]));
            pcmView.setInt16(j * 2, sample * 0x7FFF, true);
          }
          
          // Send PCM data to main thread
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


import { GoogleGenAI } from '@google/genai';

interface TranscriptionSegment {
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

export class TranscriptionCleaner {
  private ai: GoogleGenAI;
  private model = 'gemini-2.0-flash-lite';

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async cleanTranscription(
    segments: TranscriptionSegment[],
    currentAccumulated: string,
    speaker: 'user' | 'ai' = 'user'
  ): Promise<string> {
    if (!segments.length && !currentAccumulated) {
      return '';
    }

    try {
      const segmentTexts = segments.map(s => s.text).join(' | ');
      const prompt = `You are a transcription cleanup specialist for Portuguese conversations. 

TASK: Clean and correct the fragmented transcription segments to create a coherent, properly formatted sentence.

CURRENT ACCUMULATED TEXT: "${currentAccumulated}"
RAW SEGMENTS: ${segmentTexts}

RULES:
1. Remove all <noise> markers
2. Fix spacing issues (e.g., "M e u  n o m e" → "Meu nome")
3. Correct obvious fragmentation (e.g., "Me uno me é" + "Jo ão" + "Vítor" → "Meu nome é João Vítor")
4. Maintain natural Portuguese flow and grammar
5. Only return the clean text, no explanations
6. If the segments don't form coherent text, return the best possible interpretation
7. Preserve proper names and important information
8. Remove duplicate words or phrases that appear due to fragmentation

EXAMPLES:
Input: "M e u  n o m e  é  J o ã o"
Output: "Meu nome é João"

Input: "G 4 E d u c a ç ã o"
Output: "G4 Educação"

Input: "p o d e  p o d e  s i m"
Output: "pode sim"

Return only the cleaned transcription:`;

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        config: {
          temperature: 0.1,
          maxOutputTokens: 200
        }
      });

      const cleanedText = response.response.text()?.trim() || currentAccumulated;
      
      // Additional safety cleanup
      return this.postProcessText(cleanedText);
      
    } catch (error) {
      console.error('Error cleaning transcription with Gemini 2.0 Flash Lite:', error);
      // Fallback to basic cleaning
      return this.basicCleanup(currentAccumulated);
    }
  }

  private postProcessText(text: string): string {
    // Remove noise markers
    let cleaned = text.replace(/<noise>/g, '').trim();
    
    // Fix excessive spacing
    cleaned = cleaned.replace(/\s+/g, ' ');
    
    // Remove duplicate words that might have slipped through
    const words = cleaned.split(' ');
    const deduped = words.filter((word, index) => 
      index === 0 || word.toLowerCase() !== words[index - 1]?.toLowerCase()
    );
    
    return deduped.join(' ').trim();
  }

  private basicCleanup(text: string): string {
    return text
      .replace(/<noise>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

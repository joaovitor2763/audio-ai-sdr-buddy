
import { GoogleGenAI } from '@google/genai';

interface TranscriptionSegment {
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

export class TranscriptionCleaner {
  private ai: GoogleGenAI;
  private model = 'gemini-2.5-flash-preview-05-20';

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
      
      console.log("=== TRANSCRIPTION CLEANER INPUT ===");
      console.log("Raw segments:", segments);
      console.log("Segment texts joined:", segmentTexts);
      console.log("Current accumulated:", currentAccumulated);
      console.log("Speaker:", speaker);
      
      const config = {
        responseMimeType: 'text/plain',
        systemInstruction: [
          {
            text: `Você é um especialista em limpeza de transcrições para conversas em português brasileiro.

TAREFA: Limpe e corrija os segmentos de transcrição fragmentados para criar uma frase coerente e bem formatada.

REGRAS IMPORTANTES:
1. SEMPRE responda em português brasileiro
2. IGNORE completamente qualquer texto em outros idiomas (árabe, chinês, etc.) - são erros de transcrição
3. Se encontrar texto em outros idiomas, DESCONSIDERE e trabalhe apenas com o português
4. Remova todos os marcadores <noise>
5. Corrija problemas de espaçamento (ex: "M e u  n o m e" → "Meu nome")
6. Corrija fragmentação óbvia (ex: "Me uno me é" + "Jo ão" + "Vítor" → "Meu nome é João Vítor")
7. Mantenha o fluxo natural do português
8. Retorne apenas o texto limpo, sem explicações
9. Se os segmentos não formam texto coerente, retorne a melhor interpretação possível
10. Preserve nomes próprios e informações importantes
11. Remova palavras ou frases duplicadas devido à fragmentação

EXEMPLOS:
Input: "M e u  n o m e  é  J o ã o"
Output: "Meu nome é João"

Input: "G 4 E d u c a ç ã o"
Output: "G4 Educação"

Input: "A minha empresa é Empreende Brasil"
Output: "A minha empresa é Empreende Brasil"

Input: "به نام ژن ویتور" (texto em árabe)
Output: "" (ignorar texto em outros idiomas)

Retorne apenas a transcrição limpa em português:`
          }
        ],
      };

      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `TEXTO ACUMULADO ATUAL: "${currentAccumulated}"
SEGMENTOS BRUTOS: ${segmentTexts}

Limpe esta transcrição mantendo apenas o português:`
            }
          ]
        }
      ];

      console.log("=== SENDING TO GEMINI FOR TRANSCRIPTION CLEANING ===");
      console.log("Input for cleaning:", `Current: "${currentAccumulated}" | Segments: ${segmentTexts}`);

      const response = await this.ai.models.generateContent({
        model: this.model,
        config,
        contents
      });

      const cleanedText = response.text?.trim() || currentAccumulated;
      
      console.log("=== TRANSCRIPTION CLEANER OUTPUT ===");
      console.log("Gemini raw response:", response.text);
      console.log("Final cleaned text:", cleanedText);
      
      // Additional safety cleanup to ensure Portuguese only
      const finalResult = this.postProcessText(cleanedText);
      console.log("After post-processing:", finalResult);
      
      return finalResult;
      
    } catch (error) {
      console.error('Error cleaning transcription with Gemini:', error);
      // Fallback to basic cleaning
      const fallback = this.basicCleanup(currentAccumulated);
      console.log("Using fallback cleanup:", fallback);
      return fallback;
    }
  }

  private postProcessText(text: string): string {
    // Remove noise markers
    let cleaned = text.replace(/<noise>/g, '').trim();
    
    // Fix excessive spacing
    cleaned = cleaned.replace(/\s+/g, ' ');
    
    // Remove any remaining non-Latin characters (Arabic, Chinese, etc.)
    cleaned = cleaned.replace(/[\u0600-\u06FF\u4E00-\u9FFF\u0590-\u05FF]/g, '').trim();
    
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
      .replace(/[\u0600-\u06FF\u4E00-\u9FFF\u0590-\u05FF]/g, '') // Remove non-Latin scripts
      .replace(/\s+/g, ' ')
      .trim();
  }
}

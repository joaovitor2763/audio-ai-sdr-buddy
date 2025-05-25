
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

REGRAS CRÍTICAS DE LIMPEZA:
1. SEMPRE responda em português brasileiro
2. IGNORE COMPLETAMENTE texto em árabe, chinês, japonês, coreano ou qualquer idioma não-latino
3. Se encontrar caracteres não-latinos, DESCONSIDERE completamente esses segmentos
4. Remova todos os marcadores <noise>
5. Corrija problemas de espaçamento excessivo (ex: "M e u  n o m e" → "Meu nome")
6. Corrija fragmentação óbvia de palavras (ex: "Me uno me é" + "Jo ão" → "Meu nome é João")
7. Mantenha o fluxo natural do português brasileiro
8. Retorne apenas o texto limpo, sem explicações
9. Se os segmentos não formam texto coerente em português, retorne a melhor interpretação possível
10. Preserve nomes próprios e informações importantes (empresas, pessoas, etc.)
11. Remova palavras duplicadas causadas por fragmentação
12. Se não há conteúdo válido em português, retorne string vazia

PRIORIDADE DE LIMPEZA:
- Primeiro: remover completamente texto em idiomas não-latinos
- Segundo: corrigir espaçamento e fragmentação
- Terceiro: formar frases coerentes em português

EXEMPLOS DE LIMPEZA:
Input: "M e u  n o m e  é  J o ã o"
Output: "Meu nome é João"

Input: "G 4 E d u c a ç ã o"
Output: "G4 Educação"

Input: "Trabalho na Mi cro soft"
Output: "Trabalho na Microsoft"

Input: "به نام ژن ویتور" (árabe - IGNORAR)
Output: ""

Input: "Meu nome é João به نام Microsoft"
Output: "Meu nome é João Microsoft"

Input: "Conheci pelo Insta gram"
Output: "Conheci pelo Instagram"

Retorne apenas a transcrição limpa em português brasileiro ou string vazia se não há conteúdo válido:`
          }
        ],
      };

      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `TEXTO ACUMULADO: "${currentAccumulated}"
SEGMENTOS BRUTOS: ${segmentTexts}

Limpe esta transcrição mantendo apenas português brasileiro válido:`
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

      const cleanedText = response.text?.trim() || '';
      
      console.log("=== TRANSCRIPTION CLEANER OUTPUT ===");
      console.log("Gemini raw response:", response.text);
      console.log("Cleaned text before post-processing:", cleanedText);
      
      // Post-processing for additional safety
      const finalResult = this.postProcessText(cleanedText, currentAccumulated);
      console.log("Final result after post-processing:", finalResult);
      
      return finalResult;
      
    } catch (error) {
      console.error('Error cleaning transcription with Gemini:', error);
      // Fallback to basic cleaning
      const fallback = this.basicCleanup(currentAccumulated);
      console.log("Using fallback cleanup:", fallback);
      return fallback;
    }
  }

  private postProcessText(text: string, fallback: string): string {
    // Remove noise markers
    let cleaned = text.replace(/<noise>/g, '').trim();
    
    // Remove any remaining non-Latin characters (Arabic, Chinese, etc.)
    cleaned = cleaned.replace(/[\u0600-\u06FF\u4E00-\u9FFF\u0590-\u05FF\u3040-\u309F\u30A0-\u30FF]/g, '').trim();
    
    // Fix excessive spacing
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // If result is empty or too short, try basic cleanup of fallback
    if (!cleaned || cleaned.length < 2) {
      cleaned = this.basicCleanup(fallback);
    }
    
    // Remove duplicate words that might have slipped through
    if (cleaned) {
      const words = cleaned.split(' ');
      const deduped = words.filter((word, index) => 
        index === 0 || word.toLowerCase() !== words[index - 1]?.toLowerCase()
      );
      cleaned = deduped.join(' ').trim();
    }
    
    return cleaned;
  }

  private basicCleanup(text: string): string {
    return text
      .replace(/<noise>/g, '')
      .replace(/[\u0600-\u06FF\u4E00-\u9FFF\u0590-\u05FF\u3040-\u309F\u30A0-\u30FF]/g, '') // Remove non-Latin scripts
      .replace(/\s+/g, ' ')
      .trim();
  }
}

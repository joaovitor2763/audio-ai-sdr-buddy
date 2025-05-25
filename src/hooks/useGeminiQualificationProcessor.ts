
import { useCallback, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';

interface QualificationData {
  nome_completo: string;
  nome_empresa: string;
  como_conheceu_g4: string;
  faturamento_anual_aproximado: string;
  total_funcionarios_empresa: number;
  setor_empresa: string;
  principal_desafio: string;
  melhor_dia_contato_especialista: string;
  melhor_horario_contato_especialista: string;
  preferencia_contato_especialista: string;
  telefone: string;
  qualificador_nome: string;
}

interface ConversationEntry {
  speaker: string;
  text: string;
  timestamp: Date;
}

interface QualificationLogEntry {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  source: 'user' | 'ai' | 'system';
  confidence: 'high' | 'medium' | 'low';
}

interface StructuredQualificationOutput {
  nome_completo: string;
  nome_empresa: string;
  como_conheceu_g4: string;
  faturamento_anual_aproximado: string;
  total_funcionarios_empresa: string;
  setor_empresa: string;
  principal_desafio: string;
  melhor_dia_contato_especialista: string;
  melhor_horario_contato_especialista: string;
  preferencia_contato_especialista: string;
  telefone: string;
  analysis_confidence: string;
  extraction_notes: string;
}

export const useGeminiQualificationProcessor = (apiKey: string) => {
  const processingRef = useRef<boolean>(false);
  const lastProcessedTranscriptLength = useRef<number>(0);

  const processTranscriptForQualification = useCallback(async (
    conversationHistory: ConversationEntry[],
    currentData: Partial<QualificationData>,
    onDataUpdate: (data: Partial<QualificationData>) => void,
    onLogEntry: (logEntry: QualificationLogEntry) => void
  ) => {
    if (!apiKey) {
      console.warn('No API key provided for Gemini qualification processing');
      return;
    }

    // Skip if no new conversation data
    if (conversationHistory.length <= lastProcessedTranscriptLength.current) {
      console.log('No new transcript data to process');
      return;
    }

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Processing already in progress, skipping');
      return;
    }

    processingRef.current = true;
    lastProcessedTranscriptLength.current = conversationHistory.length;

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Build conversation context with ONLY actual transcript entries
      const actualConversation = conversationHistory
        .filter(entry => entry.speaker !== 'System') // Exclude system messages
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map(entry => {
          if (entry.speaker === "Usuário") {
            return `USUÁRIO: ${entry.text}`;
          } else if (entry.speaker === "Mari") {
            return `MARI: ${entry.text}`;
          }
          return `${entry.speaker.toUpperCase()}: ${entry.text}`;
        })
        .join('\n');

      console.log('=== PROCESSING TRANSCRIPT FOR QUALIFICATION ===');
      console.log('Actual conversation transcript:', actualConversation);
      console.log('Current qualification data:', currentData);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads brasileiros.

TAREFA CRÍTICA: Extraia SOMENTE informações que estão EXPLICITAMENTE mencionadas na transcrição da conversa.

REGRAS OBRIGATÓRIAS:
1. NUNCA invente ou assuma informações que não estão na transcrição
2. Se uma informação NÃO foi mencionada na conversa, use EXATAMENTE: "Informação não abordada na call"
3. Use apenas português brasileiro nas respostas
4. Extraia apenas o que foi LITERALMENTE dito pelo usuário ou confirmado pela Mari

DADOS PARA EXTRAIR (somente se mencionados na conversa):
- nome_completo: Nome completo da pessoa (só se o usuário falou)
- nome_empresa: Nome da empresa (só se o usuário mencionou)
- como_conheceu_g4: Como conheceu o G4 (só se o usuário respondeu)
- faturamento_anual_aproximado: Faturamento da empresa (só se o usuário informou)
- total_funcionarios_empresa: Número de funcionários (só se o usuário disse - apenas número)
- setor_empresa: Setor/área de atuação (só se o usuário informou)
- principal_desafio: Principal desafio mencionado (só se o usuário falou)
- melhor_dia_contato_especialista: Dia preferido (só se o usuário escolheu)
- melhor_horario_contato_especialista: Horário preferido (só se o usuário escolheu)
- preferencia_contato_especialista: Canal preferido (só se o usuário escolheu)
- telefone: Telefone para contato (só se o usuário forneceu)
- analysis_confidence: "alta", "média" ou "baixa" 
- extraction_notes: Observações sobre o que foi extraído

EXEMPLOS CORRETOS:
- Usuário diz "Meu nome é João" → nome_completo: "João"
- Usuário diz "Trabalho na Microsoft" → nome_empresa: "Microsoft"  
- Usuário diz "Conheci pelo Instagram" → como_conheceu_g4: "Instagram"
- Se usuário NÃO mencionou telefone → telefone: "Informação não abordada na call"

IMPORTANTE: Se não há conversa ou se uma informação específica não foi mencionada pelo usuário, use "Informação não abordada na call"`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `TRANSCRIÇÃO COMPLETA DA CONVERSA:
${actualConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Extraia SOMENTE as informações que foram EXPLICITAMENTE mencionadas na transcrição acima:`
            },
          ],
        },
      ];

      console.log('=== SENDING TRANSCRIPT TO GEMINI FOR EXTRACTION ===');

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      const responseText = response.text || '';
      
      console.log('=== GEMINI QUALIFICATION EXTRACTION RESPONSE ===');
      console.log('Raw response:', responseText);

      try {
        const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const extractedData: StructuredQualificationOutput = JSON.parse(cleanedResponse);
        
        console.log('Parsed qualification extraction:', extractedData);
        
        // Process extracted data and create updates
        const updates: Partial<QualificationData> = {};
        let hasUpdates = false;

        Object.entries(extractedData).forEach(([key, value]) => {
          if (key === 'analysis_confidence' || key === 'extraction_notes') {
            return;
          }

          // Only update if the value is meaningful and different from "Informação não abordada na call"
          if (value && 
              value !== '' && 
              value !== 'Informação não abordada na call' && 
              value !== 'Informação não identificada') {
            
            const oldValue = currentData[key as keyof QualificationData];
            
            // Convert total_funcionarios_empresa to number
            let processedValue = value;
            if (key === 'total_funcionarios_empresa' && typeof value === 'string') {
              const numMatch = value.match(/\d+/);
              if (numMatch) {
                const numValue = parseInt(numMatch[0]);
                if (!isNaN(numValue)) {
                  processedValue = numValue;
                }
              }
            }
            
            // Only update if the value is different and meaningful
            if (processedValue !== oldValue && processedValue !== 0) {
              (updates as any)[key] = processedValue;
              hasUpdates = true;
              
              console.log(`Qualification update - ${key}: ${oldValue} → ${processedValue}`);
              
              onLogEntry({
                timestamp: new Date(),
                field: key,
                oldValue,
                newValue: processedValue,
                source: 'ai',
                confidence: extractedData.analysis_confidence === 'alta' ? 'high' : 
                          extractedData.analysis_confidence === 'média' ? 'medium' : 'low'
              });
            }
          }
        });

        if (hasUpdates) {
          console.log('Applying qualification updates:', updates);
          onDataUpdate(updates);
          
          if (extractedData.extraction_notes) {
            onLogEntry({
              timestamp: new Date(),
              field: 'system',
              oldValue: null,
              newValue: `Extraction Notes: ${extractedData.extraction_notes}`,
              source: 'ai',
              confidence: extractedData.analysis_confidence === 'alta' ? 'high' : 
                        extractedData.analysis_confidence === 'média' ? 'medium' : 'low'
            });
          }
        } else {
          console.log('No new qualification data extracted from transcript');
        }

      } catch (parseError) {
        console.error('Error parsing qualification extraction:', parseError);
        console.error('Raw response was:', responseText);
        
        onLogEntry({
          timestamp: new Date(),
          field: 'system',
          oldValue: null,
          newValue: 'Qualification processing error: Invalid format',
          source: 'system',
          confidence: 'low'
        });
      }

    } catch (error) {
      console.error('Error in qualification processing:', error);
      
      onLogEntry({
        timestamp: new Date(),
        field: 'system',
        oldValue: null,
        newValue: `Qualification error: ${error.message}`,
        source: 'system',
        confidence: 'low'
      });
    } finally {
      processingRef.current = false;
    }
  }, [apiKey]);

  const resetProcessor = useCallback(() => {
    processingRef.current = false;
    lastProcessedTranscriptLength.current = 0;
  }, []);

  return {
    processTranscriptForQualification,
    resetProcessor
  };
};


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
  const fullConversationRef = useRef<ConversationEntry[]>([]);
  const lastFullProcessRef = useRef<number>(0);

  const processFullConversation = useCallback(async (
    conversationHistory: ConversationEntry[],
    currentData: Partial<QualificationData>,
    onDataUpdate: (data: Partial<QualificationData>) => void,
    onLogEntry: (logEntry: QualificationLogEntry) => void
  ) => {
    if (!apiKey) {
      console.warn('No API key provided for Gemini qualification processing');
      return;
    }

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Full conversation processing already in progress, skipping');
      return;
    }

    // Rate limiting - process at most every 3 seconds for full conversation
    const now = Date.now();
    if (now - lastFullProcessRef.current < 3000) {
      console.log('Rate limiting full conversation processing');
      return;
    }

    processingRef.current = true;
    lastFullProcessRef.current = now;

    // Update conversation history
    fullConversationRef.current = [...conversationHistory];

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Build complete conversation context
      const fullConversation = fullConversationRef.current
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

      console.log('=== PROCESSING FULL CONVERSATION ===');
      console.log('Full conversation:', fullConversation);
      console.log('Current data:', currentData);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads para empresas brasileiras.

TAREFA: Analise toda a conversa e extraia TODAS as informações disponíveis de qualificação.

IMPORTANTE - REGRAS DE IDIOMA:
- SEMPRE responda em português brasileiro
- IGNORE qualquer texto em outros idiomas na conversa (pode ser erro de transcrição)
- Se encontrar texto em árabe, chinês ou outros idiomas, DESCONSIDERE completamente
- Foque apenas nas partes da conversa em português

DADOS PARA EXTRAIR:
- nome_completo: Nome completo da pessoa
- nome_empresa: Nome da empresa (ex: "Empreende Brasil", "G4 Educação")
- como_conheceu_g4: Como conheceu o G4 (ex: "Instagram", "LinkedIn", "indicação")
- faturamento_anual_aproximado: Faturamento da empresa (preservar formato original)
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor/área de atuação
- principal_desafio: Principal desafio mencionado
- melhor_dia_contato_especialista: Dia preferido para contato
- melhor_horario_contato_especialista: Horário preferido
- preferencia_contato_especialista: Canal preferido (Ligação/WhatsApp)
- telefone: Telefone para contato
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações sobre a extração

ESTRATÉGIA DE EXTRAÇÃO:
1. PRIORIDADE MÁXIMA: Respostas diretas do usuário
2. SEGUNDA PRIORIDADE: Confirmações da Mari baseadas em respostas do usuário
3. TERCEIRA PRIORIDADE: Inferências do contexto da conversa

EXEMPLOS DE EXTRAÇÃO:
- Usuário: "Meu nome é João Vítor" → nome_completo: "João Vítor"
- Usuário: "A minha empresa é Empreende Brasil" → nome_empresa: "Empreende Brasil"
- Mari: "Obrigada, João Vítor" (após pergunta sobre nome) → nome_completo: "João Vítor"
- Mari: "porte da Empreende Brasil" → nome_empresa: "Empreende Brasil"

REGRAS IMPORTANTES:
- Se não há informação clara: "Informação não identificada"
- Para funcionários: extrair apenas o número
- Preservar exatamente como mencionado
- Considerar toda a conversa, não apenas partes isoladas
- SEMPRE responder em português brasileiro`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `CONVERSA COMPLETA PARA ANÁLISE:
${fullConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Analise toda a conversa e extraia TODAS as informações de qualificação disponíveis:`
            },
          ],
        },
      ];

      console.log('=== SENDING FULL CONVERSATION TO GEMINI ===');

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      const responseText = response.text || '';
      
      console.log('=== GEMINI FULL EXTRACTION RESPONSE ===');
      console.log('Raw response:', responseText);

      try {
        const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const extractedData: StructuredQualificationOutput = JSON.parse(cleanedResponse);
        
        console.log('Parsed full extraction:', extractedData);
        
        // Process extracted data and create updates
        const updates: Partial<QualificationData> = {};
        let hasUpdates = false;

        Object.entries(extractedData).forEach(([key, value]) => {
          if (key === 'analysis_confidence' || key === 'extraction_notes') {
            return;
          }

          if (value && value !== '' && value !== 'Informação não identificada' && value !== 'Informação não abordada na call') {
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
              
              console.log(`Full conversation update - ${key}: ${oldValue} → ${processedValue}`);
              
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
          console.log('Applying full conversation updates:', updates);
          onDataUpdate(updates);
          
          if (extractedData.extraction_notes) {
            onLogEntry({
              timestamp: new Date(),
              field: 'system',
              oldValue: null,
              newValue: `Full Analysis: ${extractedData.extraction_notes}`,
              source: 'ai',
              confidence: extractedData.analysis_confidence === 'alta' ? 'high' : 
                        extractedData.analysis_confidence === 'média' ? 'medium' : 'low'
            });
          }
        } else {
          console.log('No new qualification data from full conversation analysis');
        }

      } catch (parseError) {
        console.error('Error parsing full conversation extraction:', parseError);
        console.error('Raw response was:', responseText);
        
        onLogEntry({
          timestamp: new Date(),
          field: 'system',
          oldValue: null,
          newValue: 'Full conversation processing error: Invalid format',
          source: 'system',
          confidence: 'low'
        });
      }

    } catch (error) {
      console.error('Error in full conversation processing:', error);
      
      onLogEntry({
        timestamp: new Date(),
        field: 'system',
        oldValue: null,
        newValue: `Full conversation error: ${error.message}`,
        source: 'system',
        confidence: 'low'
      });
    } finally {
      processingRef.current = false;
    }
  }, [apiKey]);

  const resetProcessor = useCallback(() => {
    fullConversationRef.current = [];
    processingRef.current = false;
    lastFullProcessRef.current = 0;
  }, []);

  return {
    processFullConversation,
    resetProcessor
  };
};

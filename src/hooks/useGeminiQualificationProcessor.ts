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
  const lastProcessTimeRef = useRef<number>(0);
  const fullConversationRef = useRef<ConversationEntry[]>([]);
  const lastEntryHashRef = useRef<string>('');

  // Generate a hash of just the new entry to detect actual new content
  const generateEntryHash = (entry: ConversationEntry): string => {
    return `${entry.speaker}:${entry.text}:${entry.timestamp.getTime()}`;
  };

  const processQualificationData = useCallback(async (
    newEntry: ConversationEntry,
    currentData: Partial<QualificationData>,
    onDataUpdate: (data: Partial<QualificationData>) => void,
    onLogEntry: (logEntry: QualificationLogEntry) => void
  ) => {
    if (!apiKey) {
      console.warn('No API key provided for Gemini qualification processing');
      return;
    }

    // Generate hash for this specific entry
    const entryHash = generateEntryHash(newEntry);
    
    // Skip if we already processed this exact entry
    if (entryHash === lastEntryHashRef.current) {
      console.log('Skipping duplicate entry processing:', newEntry.text);
      return;
    }

    // Only process meaningful entries from users
    if (newEntry.speaker !== 'Usuário' || newEntry.text.trim().length < 3) {
      console.log('Skipping qualification processing - not a meaningful user entry:', newEntry);
      return;
    }

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Qualification processing already in progress, skipping');
      return;
    }

    // Simple rate limiting - process at most every 2 seconds
    const now = Date.now();
    if (now - lastProcessTimeRef.current < 2000) {
      console.log('Rate limiting qualification processing');
      return;
    }

    processingRef.current = true;
    lastProcessTimeRef.current = now;
    lastEntryHashRef.current = entryHash;

    // Add to conversation history
    fullConversationRef.current.push(newEntry);
    
    // Keep conversation history manageable (last 30 entries)
    if (fullConversationRef.current.length > 30) {
      fullConversationRef.current = fullConversationRef.current.slice(-30);
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Build focused conversation context - last 10 entries for better context
      const recentConversation = fullConversationRef.current
        .slice(-10)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map(entry => {
          if (entry.speaker === "Usuário") {
            return `USUÁRIO: ${entry.text}`;
          } else if (entry.speaker === "Mari") {
            return `MARI: ${entry.text}`;
          } else {
            return `SISTEMA: ${entry.text}`;
          }
        })
        .join('\n');

      console.log('=== PROCESSING NEW USER ENTRY ===');
      console.log('New entry:', newEntry.text);
      console.log('Recent conversation context:', recentConversation);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads.

FOCO: Extraia informações ESPECÍFICAS desta nova entrada do usuário e do contexto recente da conversa.

PRIORIDADES DE EXTRAÇÃO:
1. PRIMEIRA PRIORIDADE: Informações DIRETAS do usuário na entrada atual
2. SEGUNDA PRIORIDADE: Confirmações/correções da Mari baseadas na entrada do usuário
3. TERCEIRA PRIORIDADE: Inferências claras do contexto

EXEMPLOS DE EXTRAÇÃO DIRETA:
- Usuário: "João Vítor" → nome_completo: "João Vítor"
- Usuário: "Empreende Brasil" → nome_empresa: "Empreende Brasil"
- Usuário: "conteúdos no Instagram" → como_conheceu_g4: "conteúdos no Instagram"
- Usuário: "100 milhões por ano" → faturamento_anual_aproximado: "100 milhões por ano"
- Usuário: "80 funcionários" → total_funcionarios_empresa: "80"
- Usuário: "setor de eventos" → setor_empresa: "setor de eventos"
- Usuário: "expandir para novos mercados" → principal_desafio: "expandir para novos mercados"

CAMPOS PARA EXTRAIR:
- nome_completo: Nome completo do lead
- nome_empresa: Nome da empresa
- como_conheceu_g4: Como conheceu a G4 (preservar exato: "Instagram", "Facebook", etc.)
- faturamento_anual_aproximado: Faturamento (manter formato original)
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor/área de atuação
- principal_desafio: Principal desafio mencionado
- melhor_dia_contato_especialista: Dia preferido
- melhor_horario_contato_especialista: Horário preferido
- preferencia_contato_especialista: Canal preferido
- telefone: Número de telefone
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações sobre o que foi extraído

REGRAS:
- Se não há informação clara: "Informação não abordada na call"
- Para funcionários: extrair apenas o número
- Preservar contexto e detalhes específicos
- Focar na NOVA informação da entrada atual`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `NOVA ENTRADA DO USUÁRIO PARA PROCESSAR:
"${newEntry.text}"

CONTEXTO RECENTE DA CONVERSA:
${recentConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Extraia APENAS informações novas/atualizadas desta entrada específica do usuário:`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI FOR FOCUSED EXTRACTION ===');
      console.log('Processing entry:', newEntry.text);

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      const responseText = response.text || '';
      
      console.log('=== GEMINI EXTRACTION RESPONSE ===');
      console.log('Raw response:', responseText);

      try {
        const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const extractedData: StructuredQualificationOutput = JSON.parse(cleanedResponse);
        
        console.log('Parsed extraction:', extractedData);
        
        // Process extracted data and create updates
        const updates: Partial<QualificationData> = {};
        let hasUpdates = false;

        Object.entries(extractedData).forEach(([key, value]) => {
          if (key === 'analysis_confidence' || key === 'extraction_notes') {
            return;
          }

          if (value && value !== '' && value !== 'Informação não abordada na call') {
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
              
              console.log(`Updating field ${key}: ${oldValue} → ${processedValue}`);
              
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
              newValue: `Analysis: ${extractedData.extraction_notes}`,
              source: 'ai',
              confidence: extractedData.analysis_confidence === 'alta' ? 'high' : 
                        extractedData.analysis_confidence === 'média' ? 'medium' : 'low'
            });
          }
        } else {
          console.log('No new qualification data extracted from this entry');
        }

      } catch (parseError) {
        console.error('Error parsing qualification extraction:', parseError);
        console.error('Raw response was:', responseText);
        
        onLogEntry({
          timestamp: new Date(),
          field: 'system',
          oldValue: null,
          newValue: 'Processing error: Invalid extraction format',
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
        newValue: `Error: ${error.message}`,
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
    lastProcessTimeRef.current = 0;
    lastEntryHashRef.current = '';
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

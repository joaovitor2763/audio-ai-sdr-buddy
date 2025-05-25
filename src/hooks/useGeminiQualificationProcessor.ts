
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

    // Add to full conversation history (both user and AI)
    fullConversationRef.current.push(newEntry);
    
    // Keep conversation history manageable (last 50 entries for better context)
    if (fullConversationRef.current.length > 50) {
      fullConversationRef.current = fullConversationRef.current.slice(-50);
    }

    // Only process meaningful entries
    if (newEntry.text.trim().length < 3) {
      console.log('Skipping qualification processing for very short text:', newEntry.text);
      return;
    }

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Qualification processing already in progress, skipping');
      return;
    }

    // Rate limiting - process at most every 2 seconds for better context accumulation
    const now = Date.now();
    if (now - lastProcessTimeRef.current < 2000) {
      console.log('Rate limiting qualification processing');
      return;
    }

    processingRef.current = true;
    lastProcessTimeRef.current = now;

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Build structured conversation context separating user and AI responses
      const userResponses = fullConversationRef.current
        .filter(entry => entry.speaker === "Usuário")
        .map(entry => `USUÁRIO: ${entry.text}`)
        .join('\n');

      const fullConversation = fullConversationRef.current
        .map(entry => {
          if (entry.speaker === "Usuário") {
            return `USUÁRIO: ${entry.text}`;
          } else if (entry.speaker === "Mari") {
            return `MARI (ASSISTENTE): ${entry.text}`;
          } else {
            return `SISTEMA: ${entry.text}`;
          }
        })
        .join('\n');

      console.log('=== FULL CONVERSATION CONTEXT FOR QUALIFICATION ===');
      console.log('Total conversation entries:', fullConversationRef.current.length);
      console.log('User responses only:', userResponses);
      console.log('Full conversation:', fullConversation);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads a partir de conversas de vendas.

TAREFA: Extraia informações de qualificação APENAS das respostas do USUÁRIO na conversa completa.

INSTRUÇÕES CRÍTICAS:
1. FOQUE APENAS nas falas do "USUÁRIO" - ignore inferências das perguntas da Mari
2. Extraia informações LITERAIS das respostas do usuário
3. Preserve TODOS os detalhes e contexto mencionados pelo usuário
4. Se o usuário não mencionou algo explicitamente, use: "Informação não abordada na call"

CAMPOS PARA EXTRAIR:
- nome_completo: Nome completo mencionado pelo usuário
- nome_empresa: Nome da empresa mencionado pelo usuário  
- como_conheceu_g4: Como conheceu a G4 (preserve detalhes completos: "conteúdos no Instagram", "indicação de João Silva", etc.)
- faturamento_anual_aproximado: Faturamento mencionado (preserve formato: "400 milhões por ano", "2 milhões anuais")
- total_funcionarios_empresa: Número de funcionários (apenas número: "250")
- setor_empresa: Setor de atuação mencionado
- principal_desafio: Principal desafio mencionado pelo usuário
- melhor_dia_contato_especialista: Preferência de dia mencionada
- melhor_horario_contato_especialista: Preferência de horário mencionada  
- preferencia_contato_especialista: Preferência de canal (WhatsApp/Ligação)
- telefone: Número de telefone fornecido
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações sobre a extração

EXEMPLOS DE EXTRAÇÃO CORRETA:
- Usuário diz "conteúdos no Instagram" → {"como_conheceu_g4": "conteúdos no Instagram"}
- Usuário diz "400 milhões por ano" → {"faturamento_anual_aproximado": "400 milhões por ano"}
- Usuário diz "250 funcionários" → {"total_funcionarios_empresa": "250"}

REGRAS:
- Se usuário não mencionou: "Informação não abordada na call"
- Preserve contexto e nuances das respostas do usuário
- Para funcionários, extraia apenas o número
- NÃO faça inferências - apenas extraia o que foi dito explicitamente`
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

RESPOSTAS DO USUÁRIO (FOQUE AQUI):
${userResponses}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Extraia APENAS das falas do USUÁRIO os dados de qualificação, preservando todos os detalhes mencionados:`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI 2.5 FLASH FOR QUALIFICATION ===');
      console.log('Current data:', currentData);
      console.log('User responses length:', userResponses.length);
      console.log('Full conversation length:', fullConversation.length);

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      const responseText = response.text || '';
      
      console.log('=== GEMINI 2.5 FLASH QUALIFICATION RESPONSE ===');
      console.log('Raw response:', responseText);

      try {
        // Clean the response (remove markdown formatting if present)
        const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        const extractedData: StructuredQualificationOutput = JSON.parse(cleanedResponse);
        
        console.log('Parsed structured output:', extractedData);
        console.log('Analysis confidence:', extractedData.analysis_confidence);
        console.log('Extraction notes:', extractedData.extraction_notes);
        
        // Process extracted data and create updates
        const updates: Partial<QualificationData> = {};
        let hasUpdates = false;

        Object.entries(extractedData).forEach(([key, value]) => {
          // Skip metadata fields
          if (key === 'analysis_confidence' || key === 'extraction_notes') {
            return;
          }

          if (value && value !== '' && value !== 'Informação não abordada na call') {
            const oldValue = currentData[key as keyof QualificationData];
            
            // Convert total_funcionarios_empresa to number
            let processedValue = value;
            if (key === 'total_funcionarios_empresa' && typeof value === 'string') {
              const numValue = parseInt(value.replace(/\D/g, ''));
              if (!isNaN(numValue)) {
                processedValue = numValue;
              }
            }
            
            // Only update if the value is different and meaningful
            if (processedValue !== oldValue && processedValue !== 0) {
              (updates as any)[key] = processedValue;
              hasUpdates = true;
              
              console.log(`Updating field ${key}: ${oldValue} → ${processedValue}`);
              
              // Create log entry
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
          console.log('Updating qualification data from Gemini 2.5 Flash:', updates);
          onDataUpdate(updates);
          
          // Log the extraction notes if available
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
          console.log('No new qualification updates from structured analysis');
        }

      } catch (parseError) {
        console.error('Error parsing Gemini 2.5 Flash structured response:', parseError);
        console.error('Raw response was:', responseText);
        
        // Fallback: create log entry for processing attempt
        onLogEntry({
          timestamp: new Date(),
          field: 'system',
          oldValue: null,
          newValue: 'Processing error: Invalid structured output',
          source: 'system',
          confidence: 'low'
        });
      }

    } catch (error) {
      console.error('Error in Gemini 2.5 Flash qualification processing:', error);
      
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
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

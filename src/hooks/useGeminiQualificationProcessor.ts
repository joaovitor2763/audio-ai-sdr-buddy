
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
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastConversationHashRef = useRef<string>('');

  // Generate a simple hash of the conversation to detect actual changes
  const generateConversationHash = (conversation: ConversationEntry[]): string => {
    return conversation.map(entry => `${entry.speaker}:${entry.text}`).join('|');
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

    // Check if conversation actually changed
    const currentHash = generateConversationHash(fullConversationRef.current);
    if (currentHash === lastConversationHashRef.current) {
      console.log('No conversation changes detected, skipping qualification processing');
      return;
    }

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Qualification processing already in progress, skipping');
      return;
    }

    // Rate limiting - process at most every 3 seconds for better context accumulation
    const now = Date.now();
    if (now - lastProcessTimeRef.current < 3000) {
      console.log('Rate limiting qualification processing');
      
      // Clear existing timeout and set new one
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      
      processingTimeoutRef.current = setTimeout(() => {
        if (!processingRef.current) {
          processQualificationData(newEntry, currentData, onDataUpdate, onLogEntry);
        }
      }, 3000 - (now - lastProcessTimeRef.current));
      
      return;
    }

    processingRef.current = true;
    lastProcessTimeRef.current = now;
    lastConversationHashRef.current = currentHash;

    // Clear any pending timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Build chronological conversation context
      const chronologicalConversation = fullConversationRef.current
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

      console.log('=== QUALIFICATION PROCESSING ===');
      console.log('Total conversation entries:', fullConversationRef.current.length);
      console.log('Chronological conversation:', chronologicalConversation);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads a partir de conversas de vendas.

TAREFA: Extraia informações de qualificação usando AMBAS as falas do USUÁRIO e as confirmações/correções da MARI.

PRIORIDADE DE FONTES:
1. PRIMEIRA PRIORIDADE: Informações explícitas fornecidas pelo USUÁRIO
2. SEGUNDA PRIORIDADE: Confirmações/correções da MARI quando o usuário não foi claro
3. TERCEIRA PRIORIDADE: Inferências baseadas no contexto da conversa

INSTRUÇÕES DE EXTRAÇÃO:
- PRESERVE todos os detalhes e contexto completos mencionados pelo usuário
- Use as confirmações da Mari para validar/corrigir quando a transcrição parecer incorreta
- Para campos não mencionados: "Informação não abordada na call"
- Mantenha nuances importantes e contexto específico

CAMPOS PARA EXTRAIR:
- nome_completo: Nome completo do lead
- nome_empresa: Nome da empresa do lead
- como_conheceu_g4: Como conheceu a G4 (preservar detalhes completos como "conteúdos no Instagram", "anúncios no Facebook", etc.)
- faturamento_anual_aproximado: Faturamento mencionado (manter formato original como "100 milhões por ano")
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor/área de atuação da empresa
- principal_desafio: Principal desafio ou problema mencionado
- melhor_dia_contato_especialista: Dia preferido para contato
- melhor_horario_contato_especialista: Horário preferido para contato  
- preferencia_contato_especialista: Canal preferido (WhatsApp, telefone, email, etc.)
- telefone: Número de telefone mencionado
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações sobre a extração, fontes utilizadas e contexto

EXEMPLOS DE EXTRAÇÃO INTELIGENTE:
- Usuário: "John Vitor" → Mari: "Obrigada, João Vítor" → {"nome_completo": "João Vítor"}
- Usuário: "conteúdos no Instagram" → {"como_conheceu_g4": "conteúdos no Instagram"}
- Usuário: "Empreende Brasil" → Mari: "porte da Empreende Brasil" → {"nome_empresa": "Empreende Brasil"}
- Usuário: "100 milhões por ano" → {"faturamento_anual_aproximado": "100 milhões por ano"}

REGRAS IMPORTANTES:
- NÃO simplifique informações - preserve contexto completo
- Use Mari para validar/corrigir apenas quando necessário
- Para funcionários, extraia apenas o número final
- Seja específico nas extraction_notes sobre qual fonte foi utilizada`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `CONVERSA COMPLETA PARA ANÁLISE (ordenada cronologicamente):
${chronologicalConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Extraia dados de qualificação preservando contexto e nuances completas das respostas do usuário:`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI 2.5 FLASH FOR QUALIFICATION ===');
      console.log('Current data:', currentData);
      console.log('Conversation length:', chronologicalConversation.length);

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
              // Extract number from strings like "80 funcionários" or "80"
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
    lastConversationHashRef.current = '';
    
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

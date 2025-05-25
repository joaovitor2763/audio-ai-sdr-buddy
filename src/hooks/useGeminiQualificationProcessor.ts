
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
        temperature: 0.1, // Lowered for more consistent extraction
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads de conversas de vendas em português brasileiro.

REGRA FUNDAMENTAL: EXTRAIA INFORMAÇÕES LITERALMENTE DO QUE O USUÁRIO DISSE, sem interpretação ou correção.

INSTRUÇÕES ESPECÍFICAS:
1. LEIA CADA FALA DO USUÁRIO palavra por palavra
2. EXTRAIA exatamente o que foi dito, preservando o formato original
3. NÃO corrija erros de transcrição - use o que foi transcrito
4. Para campos não mencionados explicitamente: "Informação não abordada na call"

CAMPOS OBRIGATÓRIOS (extrair APENAS do que o usuário disse):
- nome_completo: Nome que o usuário forneceu
- nome_empresa: Nome da empresa mencionado pelo usuário
- como_conheceu_g4: EXATAMENTE como o usuário disse que conheceu (ex: "acompanho os conteúdos no Instagram")
- faturamento_anual_aproximado: Valor mencionado pelo usuário
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor mencionado pelo usuário
- principal_desafio: Desafio mencionado nas palavras do usuário
- melhor_dia_contato_especialista: Dia preferido mencionado
- melhor_horario_contato_especialista: Horário mencionado
- preferencia_contato_especialista: Canal preferido mencionado
- telefone: Telefone fornecido
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Detalhes sobre o que foi extraído de cada fala

EXEMPLOS DE EXTRAÇÃO CORRETA:
- Usuário: "acompanho os conteúdos no Instagram" → como_conheceu_g4: "acompanho os conteúdos no Instagram"
- Usuário: "80 funcionários" → total_funcionarios_empresa: "80"
- Usuário: "desafio de turno ver meu time" → principal_desafio: "desafio de turno ver meu time"

IMPORTANTE:
- NÃO interprete ou "corrija" o que o usuário disse
- NÃO use informações das falas da Mari, apenas do usuário
- PRESERVE exatamente as palavras utilizadas pelo usuário
- Se o usuário repetir informação, use a versão mais clara`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `CONVERSA PARA ANÁLISE (em ordem cronológica):
${chronologicalConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

TAREFA: Extraia APENAS informações explícitas fornecidas pelo USUÁRIO. Não interprete, não corrija, extraia literalmente o que foi dito.

FOQUE especialmente em:
1. Nome que o usuário forneceu
2. Como conheceu a G4 (extrair palavras exatas do usuário)
3. Desafios mencionados (palavras exatas)
4. Informações da empresa (nome, funcionários, setor)
5. Preferências de contato

Retorne JSON estruturado:`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI FOR QUALIFICATION (Temperature: 0.1) ===');
      console.log('Current data:', currentData);
      console.log('Conversation length:', chronologicalConversation.length);

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      const responseText = response.text || '';
      
      console.log('=== GEMINI QUALIFICATION RESPONSE ===');
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
          console.log('Updating qualification data from Gemini:', updates);
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
          console.log('No new qualification updates from analysis');
        }

      } catch (parseError) {
        console.error('Error parsing Gemini structured response:', parseError);
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
      console.error('Error in Gemini qualification processing:', error);
      
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

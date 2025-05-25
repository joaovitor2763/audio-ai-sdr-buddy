
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

    // Only process when Mari finishes talking or on significant user input
    const shouldProcess = newEntry.speaker === "Mari" || 
                         (newEntry.speaker === "Usuário" && newEntry.text.trim().length > 5);
    
    if (!shouldProcess) {
      console.log('Skipping qualification processing - waiting for Mari completion or substantial user input');
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

    // Rate limiting - process at most every 2 seconds for Mari completions
    const now = Date.now();
    const minInterval = newEntry.speaker === "Mari" ? 2000 : 3000;
    
    if (now - lastProcessTimeRef.current < minInterval) {
      console.log('Rate limiting qualification processing');
      
      // Clear existing timeout and set new one
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      
      processingTimeoutRef.current = setTimeout(() => {
        if (!processingRef.current) {
          processQualificationData(newEntry, currentData, onDataUpdate, onLogEntry);
        }
      }, minInterval - (now - lastProcessTimeRef.current));
      
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
      console.log('Processing triggered by:', newEntry.speaker);
      console.log('Chronological conversation:', chronologicalConversation);

      const config = {
        responseMimeType: 'application/json',
        temperature: 0.1,
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads de conversas de vendas em português brasileiro.

OBJETIVO: Extrair informações de qualificação analisando TODA A CONVERSA (falas da Mari E do usuário).

INSTRUÇÕES DE ANÁLISE:
1. ANALISE tanto as perguntas da Mari quanto as respostas do usuário
2. Use o CONTEXTO COMPLETO da conversa para inferir informações
3. Quando o usuário responde uma pergunta da Mari, associe a resposta à pergunta correspondente
4. Se a transcrição do usuário estiver confusa, use o contexto da pergunta da Mari para inferir o significado
5. PRIORIZE informações explícitas, mas use inferência contextual quando necessário

CAMPOS OBRIGATÓRIOS para extrair:
- nome_completo: Nome que o usuário forneceu
- nome_empresa: Nome da empresa mencionado
- como_conheceu_g4: Como conheceu a G4 (analisar pergunta da Mari + resposta do usuário)
- faturamento_anual_aproximado: Valor de faturamento mencionado
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor de atuação da empresa
- principal_desafio: Desafio principal mencionado
- melhor_dia_contato_especialista: Melhor dia para contato
- melhor_horario_contato_especialista: Melhor horário para contato
- preferencia_contato_especialista: Canal preferido de contato
- telefone: Telefone fornecido
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Explicação detalhada de como cada informação foi extraída

EXEMPLOS DE ANÁLISE CONTEXTUAL:
1. Mari: "Como você conheceu a G4 Educação? Viu a gente no Instagram, foi indicação ou como foi?"
   Usuário: "Eu acompanho os conteúdos no Instagram."
   → como_conheceu_g4: "Instagram - acompanha os conteúdos"

2. Mari: "E quantos funcionários mais ou menos vocês têm na empresa hoje?"
   Usuário: "Tô com 80 funcionários."
   → total_funcionarios_empresa: "80"

3. Mari: "Qual é o principal desafio que a sua empresa tá enfrentando agora?"
   Usuário: "Eu tô com um desafio de turno ver aqui meu time." (pode estar falando sobre turnover)
   → principal_desafio: "turnover da equipe" (inferido do contexto)

REGRAS IMPORTANTES:
- Use informações de AMBOS os falantes (Mari + Usuário)
- Quando a transcrição estiver confusa, use o contexto da pergunta para inferir
- Para campos não mencionados: "Informação não abordada na call"
- SEMPRE explique seu raciocínio em extraction_notes
- Seja preciso mas use inferência inteligente quando apropriado`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `CONVERSA COMPLETA PARA ANÁLISE (em ordem cronológica):
${chronologicalConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

TAREFA: 
1. Analise TODA a conversa (Mari + Usuário)
2. Extraia informações usando o contexto completo
3. Associe respostas do usuário às perguntas correspondentes da Mari
4. Use inferência inteligente quando a transcrição estiver confusa
5. Explique seu raciocínio em extraction_notes

FOQUE especialmente em:
- Perguntas da Mari e respostas correspondentes do usuário
- Contexto das perguntas para interpretar respostas confusas
- Informações explícitas E implícitas na conversa
- Associação correta entre pergunta e resposta

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

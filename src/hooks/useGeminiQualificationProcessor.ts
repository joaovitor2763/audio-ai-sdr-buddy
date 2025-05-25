
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

      // Build structured conversation context with both user and Mari responses
      const userResponses = fullConversationRef.current
        .filter(entry => entry.speaker === "Usuário")
        .map(entry => `USUÁRIO: ${entry.text}`)
        .join('\n');

      const mariResponses = fullConversationRef.current
        .filter(entry => entry.speaker === "Mari")
        .map(entry => `MARI: ${entry.text}`)
        .join('\n');

      const fullConversation = fullConversationRef.current
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

      console.log('=== FULL CONVERSATION CONTEXT FOR QUALIFICATION ===');
      console.log('Total conversation entries:', fullConversationRef.current.length);
      console.log('User responses:', userResponses);
      console.log('Mari responses:', mariResponses);
      console.log('Full conversation:', fullConversation);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads a partir de conversas de vendas completas.

TAREFA: Extraia informações de qualificação usando AMBAS as falas do USUÁRIO e as respostas/confirmações da MARI.

PRIORIDADE DE FONTES:
1. PRIMEIRA PRIORIDADE: Informações explícitas do USUÁRIO
2. SEGUNDA PRIORIDADE: Confirmações/correções da MARI (quando o usuário não foi claro)
3. Use Mari para validar/corrigir dados quando a transcrição do usuário parecer incorreta

INSTRUÇÕES DE EXTRAÇÃO:
- PRESERVE todos os detalhes e contexto completos mencionados
- Se Mari corrige ou confirma algo (ex: "Obrigada, João Vítor" quando usuário disse "John Vitor"), use a versão da Mari
- Para campos não mencionados explicitamente: "Informação não abordada na call"
- Mantenha nuances importantes (ex: "conteúdos no Instagram" NÃO simplifique para apenas "Instagram")

CAMPOS PARA EXTRAIR:
- nome_completo: Nome do lead (priorize correções da Mari se houver)
- nome_empresa: Nome da empresa mencionada
- como_conheceu_g4: Como conheceu a G4 (preserve detalhes completos)
- faturamento_anual_aproximado: Faturamento mencionado (formato original)
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor de atuação
- principal_desafio: Principal desafio mencionado
- melhor_dia_contato_especialista: Preferência de dia
- melhor_horario_contato_especialista: Preferência de horário
- preferencia_contato_especialista: Preferência de canal
- telefone: Número de telefone
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações sobre a extração e fontes utilizadas

EXEMPLOS DE EXTRAÇÃO INTELIGENTE:
- Usuário: "John Vitor" → Mari: "Obrigada, João Vítor" → {"nome_completo": "João Vítor", "extraction_notes": "Nome corrigido baseado na confirmação da Mari"}
- Usuário: "conteúdos no Instagram" → {"como_conheceu_g4": "conteúdos no Instagram"}
- Usuário: "400 milhões por ano" → {"faturamento_anual_aproximado": "400 milhões por ano"}

REGRAS IMPORTANTES:
- NÃO simplifique informações - preserve contexto completo
- Use Mari para validar/corrigir quando necessário
- Para funcionários, extraia apenas o número
- Seja específico nas extraction_notes sobre qual fonte foi usada`
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

RESPOSTAS DO USUÁRIO:
${userResponses}

RESPOSTAS DA MARI (para confirmações/correções):
${mariResponses}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Extraia dados de qualificação usando ambas as fontes (usuário prioritário, Mari para confirmações/correções):`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI 2.5 FLASH FOR QUALIFICATION ===');
      console.log('Current data:', currentData);
      console.log('User responses length:', userResponses.length);
      console.log('Mari responses length:', mariResponses.length);
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
              // Extract number from strings like "250 funcionários" or "250"
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
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

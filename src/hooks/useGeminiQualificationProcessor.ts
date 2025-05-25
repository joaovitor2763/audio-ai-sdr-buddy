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

    // Rate limiting - process at most every 3 seconds for better context accumulation
    const now = Date.now();
    if (now - lastProcessTimeRef.current < 3000) {
      console.log('Rate limiting qualification processing');
      return;
    }

    processingRef.current = true;
    lastProcessTimeRef.current = now;

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Build full conversation context
      const fullConversationText = fullConversationRef.current
        .map(entry => `${entry.speaker}: ${entry.text}`)
        .join('\n');

      console.log('=== FULL CONVERSATION CONTEXT ===');
      console.log('Total entries:', fullConversationRef.current.length);
      console.log('Conversation:', fullConversationText);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em análise de conversas para extração de dados de qualificação de leads da G4 Educação.

TAREFA: Analise a conversa COMPLETA entre o usuário e Mari (assistente da G4) e extraia informações de qualificação preservando contexto e nuances.

IMPORTANTE: 
- Analise TODA a conversa desde o início
- Preserve contexto e nuances nas respostas
- Se uma informação não foi mencionada na conversa, use: "Informação não abordada na call"
- Mantenha detalhes importantes (ex: "Instagram - conteúdos orgânicos" vs "Instagram - anúncios")
- Para números, extraia apenas o valor numérico quando possível

CAMPOS PARA EXTRAIR:
- nome_completo: Nome completo da pessoa
- nome_empresa: Nome da empresa/organização
- como_conheceu_g4: Como conheceu a G4 (preserve detalhes: "Instagram através de conteúdos", "LinkedIn", "indicação de João", etc.)
- faturamento_anual_aproximado: Faturamento anual (preserve formato mencionado)
- total_funcionarios_empresa: Número de funcionários (apenas número, ex: "50")
- setor_empresa: Setor de atuação da empresa
- principal_desafio: Principal desafio mencionado
- melhor_dia_contato_especialista: Melhor dia para contato
- melhor_horario_contato_especialista: Melhor horário para contato
- preferencia_contato_especialista: Preferência de contato (WhatsApp/Ligação)
- telefone: Número de telefone (apenas números)
- analysis_confidence: "alta", "média" ou "baixa" - sua confiança na extração
- extraction_notes: Observações sobre o contexto ou incertezas

REGRAS DE EXTRAÇÃO:
1. Se informação não foi mencionada: "Informação não abordada na call"
2. Preserve contexto e detalhes nas respostas
3. Para funcionários, extraia apenas o número (ex: 250, não "250 funcionários")
4. Mantenha nuances (ex: "Instagram - conteúdos educacionais" vs apenas "Instagram")
5. Se múltiplas informações sobre o mesmo campo, use a mais recente ou completa

EXEMPLO DE SAÍDA:
{
  "nome_completo": "João Vítor Silva",
  "nome_empresa": "G4 Educação",
  "como_conheceu_g4": "Instagram através de conteúdos sobre educação",
  "faturamento_anual_aproximado": "Informação não abordada na call",
  "total_funcionarios_empresa": "250",
  "setor_empresa": "educação",
  "principal_desafio": "captação e retenção de alunos",
  "melhor_dia_contato_especialista": "Informação não abordada na call",
  "melhor_horario_contato_especialista": "Informação não abordada na call",
  "preferencia_contato_especialista": "Informação não abordada na call",
  "telefone": "Informação não abordada na call",
  "analysis_confidence": "alta",
  "extraction_notes": "Nome e empresa claramente mencionados, contexto do Instagram bem definido"
}`
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
${fullConversationText}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

Analise esta conversa completa e extraia TODOS os dados de qualificação mencionados, preservando contexto e nuances:`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI 2.5 FLASH FOR QUALIFICATION ===');
      console.log('Current data:', currentData);
      console.log('Full conversation length:', fullConversationText.length);

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
              const numValue = parseInt(value);
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


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
  const lastProcessedConversationHash = useRef<string>('');
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Generate conversation hash for change detection
  const generateConversationHash = useCallback((conversation: ConversationEntry[]): string => {
    return conversation
      .filter(entry => entry.speaker !== 'System')
      .map(entry => `${entry.speaker}:${entry.text}:${entry.timestamp.getTime()}`)
      .join('|');
  }, []);

  // Detect conversation language
  const detectConversationLanguage = useCallback((conversation: ConversationEntry[]): string => {
    const textContent = conversation
      .filter(entry => entry.speaker !== 'System')
      .map(entry => entry.text)
      .join(' ');
    
    // Simple language detection based on common Portuguese words
    const portugueseWords = ['meu', 'nome', 'empresa', 'trabalho', 'conheci', 'instagram', 'faturamento', 'funcionários', 'desafio', 'contato'];
    const foundPortuguese = portugueseWords.some(word => 
      textContent.toLowerCase().includes(word)
    );
    
    return foundPortuguese ? 'pt-BR' : 'pt-BR'; // Default to Portuguese
  }, []);

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

    // Clear existing debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    // Filter meaningful conversation
    const meaningfulConversation = conversationHistory
      .filter(entry => 
        entry.speaker !== 'System' && 
        entry.text.trim().length > 0 &&
        !entry.text.includes('<noise>')
      );

    if (meaningfulConversation.length === 0) {
      console.log('No meaningful conversation to process');
      return;
    }

    // Generate conversation hash for change detection
    const conversationHash = generateConversationHash(meaningfulConversation);
    
    // Skip if no changes detected
    if (conversationHash === lastProcessedConversationHash.current) {
      console.log('No conversation changes detected, skipping processing');
      return;
    }

    // Prevent concurrent processing with rate limiting
    if (processingRef.current) {
      console.log('Processing already in progress, debouncing for 2 seconds');
      debounceTimeoutRef.current = setTimeout(() => {
        processTranscriptForQualification(conversationHistory, currentData, onDataUpdate, onLogEntry);
      }, 2000);
      return;
    }

    processingRef.current = true;
    lastProcessedConversationHash.current = conversationHash;

    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

      // Detect conversation language
      const detectedLanguage = detectConversationLanguage(meaningfulConversation);

      // Build conversation context - FULL conversation for context
      const fullConversation = meaningfulConversation
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

      console.log('=== PROCESSING FULL CONVERSATION FOR QUALIFICATION ===');
      console.log('Full conversation:', fullConversation);
      console.log('Current qualification data:', currentData);
      console.log('Detected language:', detectedLanguage);

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em extração de dados de qualificação de leads brasileiros.

TAREFA CRÍTICA: Extraia SOMENTE informações que estão EXPLICITAMENTE mencionadas na transcrição da conversa COMPLETA.

REGRAS OBRIGATÓRIAS:
1. Analise a conversa COMPLETA para extrair informações
2. NUNCA invente ou assuma informações que não estão na transcrição
3. Se uma informação NÃO foi mencionada na conversa, use EXATAMENTE: "Informação não abordada na call"
4. Use SEMPRE português brasileiro nas respostas
5. Extraia informações tanto do que o USUÁRIO falou quanto do que a MARI confirmou ou repetiu
6. Se o usuário falou algo confuso mas a Mari repetiu/confirmou corretamente, use a versão da Mari
7. Prefira informações mais recentes na conversa se houver conflitos
8. IGNORE completamente qualquer texto em árabe, chinês ou outros idiomas - são erros de transcrição

DADOS PARA EXTRAIR (somente se mencionados na conversa):
- nome_completo: Nome completo da pessoa (do usuário ou confirmado pela Mari)
- nome_empresa: Nome da empresa (do usuário ou confirmado pela Mari)
- como_conheceu_g4: Como conheceu o G4 (Instagram, indicação, etc.)
- faturamento_anual_aproximado: Faturamento da empresa (valores em reais)
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor/área de atuação da empresa
- principal_desafio: Principal desafio mencionado
- melhor_dia_contato_especialista: Dia preferido para contato
- melhor_horario_contato_especialista: Horário preferido para contato
- preferencia_contato_especialista: Canal preferido (WhatsApp, telefone, etc.)
- telefone: Telefone para contato (com DDD)
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações sobre o que foi extraído

EXEMPLOS DE EXTRAÇÃO CORRETA:
- Usuário: "Me chamo João Silva" → nome_completo: "João Silva"
- Mari: "Entendi, João Silva da Microsoft, correto?" → nome_completo: "João Silva", nome_empresa: "Microsoft"
- Usuário: "Conheci pelo Insta" / Mari: "Instagram, certo?" → como_conheceu_g4: "Instagram"
- Usuário fala confuso: "Mpresa Mi cro soft" / Mari: "Microsoft, correto?" → nome_empresa: "Microsoft"

IMPORTANTE: 
- Se não há conversa ou informação específica não mencionada → "Informação não abordada na call"
- Procure por informações confirmadas pela Mari quando o usuário não foi claro
- Use sempre português brasileiro, mesmo que o input contenha outros idiomas
- Confie mais nas confirmações da Mari quando há dúvidas na transcrição do usuário`
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
${fullConversation}

DADOS ATUALMENTE CAPTURADOS:
${JSON.stringify(currentData, null, 2)}

INSTRUÇÕES:
- Extraia SOMENTE as informações que foram EXPLICITAMENTE mencionadas na transcrição
- Considere tanto as falas do usuário quanto as confirmações da Mari
- Se Mari confirmou/repetiu algo que o usuário disse de forma confusa, use a versão da Mari
- Use "Informação não abordada na call" para dados não mencionados
- Responda SEMPRE em português brasileiro

Extraia as informações de qualificação da conversa completa:`
            },
          ],
        },
      ];

      console.log('=== SENDING FULL CONVERSATION TO GEMINI FOR EXTRACTION ===');

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
        
        // Post-process to ensure Portuguese output
        const processedData: StructuredQualificationOutput = { ...extractedData };
        Object.keys(processedData).forEach(key => {
          if (typeof processedData[key as keyof StructuredQualificationOutput] === 'string') {
            let value = processedData[key as keyof StructuredQualificationOutput] as string;
            // Remove any non-Latin characters (Arabic, Chinese, etc.)
            value = value.replace(/[\u0600-\u06FF\u4E00-\u9FFF\u0590-\u05FF]/g, '').trim();
            if (value === '' || value === 'null' || value === 'undefined') {
              value = 'Informação não abordada na call';
            }
            (processedData as any)[key] = value;
          }
        });
        
        // Process extracted data and create updates
        const updates: Partial<QualificationData> = {};
        let hasUpdates = false;

        Object.entries(processedData).forEach(([key, value]) => {
          if (key === 'analysis_confidence' || key === 'extraction_notes') {
            return;
          }

          // Only update if the value is meaningful and different from current
          if (value && 
              value !== '' && 
              value !== 'Informação não abordada na call' && 
              value !== 'Informação não identificada' &&
              value !== 'null' &&
              value !== 'undefined') {
            
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
          
          if (processedData.extraction_notes && processedData.extraction_notes !== 'Informação não abordada na call') {
            onLogEntry({
              timestamp: new Date(),
              field: 'system',
              oldValue: null,
              newValue: `Extraction Notes: ${processedData.extraction_notes}`,
              source: 'ai',
              confidence: extractedData.analysis_confidence === 'alta' ? 'high' : 
                        extractedData.analysis_confidence === 'média' ? 'medium' : 'low'
            });
          }
        } else {
          console.log('No new qualification data extracted from conversation');
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
  }, [apiKey, generateConversationHash, detectConversationLanguage]);

  const resetProcessor = useCallback(() => {
    processingRef.current = false;
    lastProcessedConversationHash.current = '';
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
  }, []);

  return {
    processTranscriptForQualification,
    resetProcessor
  };
};

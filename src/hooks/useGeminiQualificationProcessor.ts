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

export const useGeminiQualificationProcessor = (apiKey: string) => {
  const processingRef = useRef<boolean>(false);
  const lastProcessTimeRef = useRef<number>(0);
  const conversationBufferRef = useRef<ConversationEntry[]>([]);

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

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Qualification processing already in progress, queueing entry');
      conversationBufferRef.current.push(newEntry);
      return;
    }

    // Add to conversation buffer
    conversationBufferRef.current.push(newEntry);
    
    // Keep only last 10 entries for context
    if (conversationBufferRef.current.length > 10) {
      conversationBufferRef.current = conversationBufferRef.current.slice(-10);
    }

    // Rate limiting - process at most every 2 seconds
    const now = Date.now();
    if (now - lastProcessTimeRef.current < 2000) {
      console.log('Rate limiting qualification processing');
      return;
    }

    processingRef.current = true;
    lastProcessTimeRef.current = now;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const systemPrompt = `Você é um especialista em análise de dados de qualificação de leads para a G4 Educação. 

TAREFA: Analise a conversa recente e extraia/atualize informações de qualificação baseado no contexto completo.

CAMPOS DE QUALIFICAÇÃO:
- nome_completo: Nome completo da pessoa
- nome_empresa: Nome da empresa/organização  
- como_conheceu_g4: Como conheceu o G4 (Google, LinkedIn, indicação, etc.)
- faturamento_anual_aproximado: Faturamento anual (ex: "R$ 5.000.000")
- total_funcionarios_empresa: Número de funcionários (número inteiro)
- setor_empresa: Setor de atuação (ex: "tecnologia", "educação")
- principal_desafio: Principal desafio da empresa
- melhor_dia_contato_especialista: Melhor dia para contato
- melhor_horario_contato_especialista: Melhor horário para contato
- preferencia_contato_especialista: "Ligacao" ou "WhatsApp"
- telefone: Número de telefone (apenas números)
- qualificador_nome: Nome do qualificador (sempre "Mari")

DADOS ATUAIS:
${JSON.stringify(currentData, null, 2)}

CONVERSA RECENTE:
${conversationBufferRef.current.map(entry => `${entry.speaker}: ${entry.text}`).join('\n')}

INSTRUÇÕES:
1. Analise TODA a conversa (usuário E Mari) para entender o contexto
2. Extraia apenas informações EXPLICITAMENTE mencionadas
3. Retorne APENAS campos que foram identificados ou atualizados
4. Se nenhuma informação nova foi encontrada, retorne objeto vazio: {}
5. Para cada campo extraído, inclua um campo adicional "_confidence" (high/medium/low)

FORMATO DE RESPOSTA (JSON):
{
  "campo_identificado": "valor",
  "campo_identificado_confidence": "high|medium|low"
}`;

      const model = ai.getGenerativeModel({ 
        model: "gemini-2.0-flash-lite",
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 1000,
        }
      });

      const result = await model.generateContent(systemPrompt);
      const responseText = result.response.text();
      
      console.log('Gemini 2.0 Flash Lite qualification response:', responseText);

      try {
        const extractedData = JSON.parse(responseText);
        
        // Process extracted data and create log entries
        const updates: Partial<QualificationData> = {};
        const hasUpdates = Object.keys(extractedData).some(key => !key.endsWith('_confidence'));
        
        if (!hasUpdates) {
          console.log('No qualification updates from Gemini 2.0 Flash Lite');
          return;
        }

        Object.entries(extractedData).forEach(([key, value]) => {
          if (!key.endsWith('_confidence') && value && value !== '') {
            const confidenceKey = `${key}_confidence`;
            const confidence = extractedData[confidenceKey] || 'medium';
            const oldValue = currentData[key as keyof QualificationData];
            
            if (value !== oldValue) {
              (updates as any)[key] = value;
              
              // Create log entry
              onLogEntry({
                timestamp: new Date(),
                field: key,
                oldValue,
                newValue: value,
                source: newEntry.speaker === 'Usuário' ? 'user' : 'ai',
                confidence: confidence as 'high' | 'medium' | 'low'
              });
            }
          }
        });

        if (Object.keys(updates).length > 0) {
          console.log('Updating qualification data from Gemini 2.0 Flash Lite:', updates);
          onDataUpdate(updates);
        }

      } catch (parseError) {
        console.error('Error parsing Gemini 2.0 Flash Lite response:', parseError);
        
        // Fallback: create log entry for processing attempt
        onLogEntry({
          timestamp: new Date(),
          field: 'system',
          oldValue: null,
          newValue: 'Processing error',
          source: 'system',
          confidence: 'low'
        });
      }

    } catch (error) {
      console.error('Error in Gemini 2.0 Flash Lite qualification processing:', error);
      
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
      
      // Process any queued entries
      if (conversationBufferRef.current.length > 1) {
        setTimeout(() => {
          const nextEntry = conversationBufferRef.current[conversationBufferRef.current.length - 1];
          if (nextEntry && nextEntry !== newEntry) {
            processQualificationData(nextEntry, currentData, onDataUpdate, onLogEntry);
          }
        }, 1000);
      }
    }
  }, [apiKey]);

  const resetProcessor = useCallback(() => {
    conversationBufferRef.current = [];
    processingRef.current = false;
    lastProcessTimeRef.current = 0;
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

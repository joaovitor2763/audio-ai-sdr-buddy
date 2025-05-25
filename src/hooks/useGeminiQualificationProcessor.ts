
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

    // Add to conversation buffer
    conversationBufferRef.current.push(newEntry);
    
    // Keep only last 20 entries for better context
    if (conversationBufferRef.current.length > 20) {
      conversationBufferRef.current = conversationBufferRef.current.slice(-20);
    }

    // Process any meaningful entry
    if (newEntry.text.trim().length < 3) {
      console.log('Skipping qualification processing for very short text:', newEntry.text);
      return;
    }

    // Prevent concurrent processing
    if (processingRef.current) {
      console.log('Qualification processing already in progress, skipping');
      return;
    }

    // Reduced rate limiting - process at most every 2 seconds
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

      const conversationText = conversationBufferRef.current
        .map(entry => `${entry.speaker}: ${entry.text}`)
        .join('\n');

      const config = {
        responseMimeType: 'application/json',
        systemInstruction: [
          {
            text: `Você é um especialista em análise de dados de qualificação de leads para a G4 Educação.

IMPORTANTE: Analise TODA a conversa para extrair informações de qualificação. Procure por informações EXPLICITAMENTE mencionadas e use contexto para identificar dados implícitos.

CAMPOS PARA EXTRAIR:
- nome_completo: Nome completo da pessoa (ex: "João Silva", "Maria Santos", "João Vítor")
- nome_empresa: Nome da empresa/organização (ex: "G4 Educação", "Microsoft", "Banco do Brasil")
- como_conheceu_g4: Como conheceu o G4 (ex: "Google", "LinkedIn", "indicação", "Instagram", "conteúdos no Instagram")
- faturamento_anual_aproximado: Faturamento anual em texto (ex: "R$ 5.000.000", "5 milhões", "500 mil reais")
- total_funcionarios_empresa: Número de funcionários (ex: 50, 100, 250)
- setor_empresa: Setor de atuação (ex: "educação", "tecnologia", "saúde", "financeiro")
- principal_desafio: Principal desafio da empresa (ex: "captação de alunos", "gestão de processos")
- melhor_dia_contato_especialista: Melhor dia para contato (ex: "segunda", "terça-feira")
- melhor_horario_contato_especialista: Melhor horário (ex: "manhã", "14h às 16h", "tarde")
- preferencia_contato_especialista: "Ligacao" ou "WhatsApp"
- telefone: Número de telefone (apenas números)

CONTEXTO IMPORTANTE:
- Quando alguém diz trabalhar "na G4 Educação" ou mencionar "G4 Educação", isso é o nome da empresa
- "Instagram", "Insta", "conteúdos do Instagram" = como_conheceu_g4: "Instagram"
- Números de funcionários devem ser extraídos como números inteiros
- Faturamento deve manter formato mencionado (ex: "5 milhões", "500 mil")

INSTRUÇÕES:
1. Analise TODO o contexto da conversa desde o início
2. Extraia informações que foram CLARAMENTE mencionadas OU que podem ser deduzidas do contexto
3. Para números de funcionários, extraia apenas o número (ex: 250, não "250 funcionários")
4. Para faturamento, mantenha o formato original mencionado
5. Se uma informação foi mencionada mas já existe nos dados atuais E é a mesma, não a inclua novamente
6. Retorne APENAS campos novos ou atualizados
7. Se nenhuma informação nova, retorne: {}

EXEMPLOS BASEADOS NA CONVERSA:
- "Meu nome é João Vítor" → {"nome_completo": "João Vítor"}
- "G4 Educação" → {"nome_empresa": "G4 Educação"}
- "conheceu através de conteúdos no Instagram" → {"como_conheceu_g4": "Instagram"}
- "empresa tem faturamento aproximado de 500 mil por ano e 250 funcionários" → {"faturamento_anual_aproximado": "500 mil", "total_funcionarios_empresa": 250}
- "empresa atua no setor de educação" → {"setor_empresa": "educação"}

RESPOSTA (JSON apenas):`
          }
        ],
      };

      const model = 'gemini-2.5-flash-preview-05-20';
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: `DADOS ATUAIS:
${JSON.stringify(currentData, null, 2)}

CONVERSA COMPLETA:
${conversationText}

Analise esta conversa completa e extraia TODOS os dados de qualificação mencionados:`
            },
          ],
        },
      ];

      console.log('=== SENDING TO GEMINI 2.5 FLASH FOR QUALIFICATION ===');
      console.log('Current data:', currentData);
      console.log('Conversation:', conversationText);

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
        const extractedData = JSON.parse(cleanedResponse);
        
        console.log('Parsed extracted data:', extractedData);
        
        // Process extracted data and create log entries
        const updates: Partial<QualificationData> = {};
        const hasUpdates = Object.keys(extractedData).length > 0;
        
        if (!hasUpdates) {
          console.log('No qualification updates from Gemini 2.5 Flash');
          return;
        }

        Object.entries(extractedData).forEach(([key, value]) => {
          if (value && value !== '' && value !== 0) {
            const oldValue = currentData[key as keyof QualificationData];
            
            // Only update if the value is different
            if (value !== oldValue) {
              (updates as any)[key] = value;
              
              console.log(`Updating field ${key}: ${oldValue} → ${value}`);
              
              // Create log entry
              onLogEntry({
                timestamp: new Date(),
                field: key,
                oldValue,
                newValue: value,
                source: newEntry.speaker === 'Usuário' ? 'user' : 'ai',
                confidence: 'high'
              });
            }
          }
        });

        if (Object.keys(updates).length > 0) {
          console.log('Updating qualification data from Gemini 2.5 Flash:', updates);
          onDataUpdate(updates);
        } else {
          console.log('No new updates to apply');
        }

      } catch (parseError) {
        console.error('Error parsing Gemini 2.5 Flash response:', parseError);
        console.error('Raw response was:', responseText);
        
        // Fallback: create log entry for processing attempt
        onLogEntry({
          timestamp: new Date(),
          field: 'system',
          oldValue: null,
          newValue: 'Processing error: Invalid JSON response',
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
    conversationBufferRef.current = [];
    processingRef.current = false;
    lastProcessTimeRef.current = 0;
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

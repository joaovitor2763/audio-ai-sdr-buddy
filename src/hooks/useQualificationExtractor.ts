
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

interface ConversationTurn {
  speaker: string;
  text: string;
  timestamp: Date;
}

export const useQualificationExtractor = (apiKey: string) => {
  const conversationHistoryRef = useRef<ConversationTurn[]>([]);
  const lastExtractedDataRef = useRef<Partial<QualificationData>>({});

  const extractQualificationData = useCallback(async (
    newTurn: ConversationTurn,
    onDataExtracted: (data: Partial<QualificationData>) => void
  ) => {
    if (!apiKey) {
      console.warn('No API key provided for qualification extraction');
      return;
    }

    // Add new turn to conversation history
    conversationHistoryRef.current.push(newTurn);

    // Keep only last 10 turns to avoid token limits
    if (conversationHistoryRef.current.length > 10) {
      conversationHistoryRef.current = conversationHistoryRef.current.slice(-10);
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const config = {
        responseMimeType: 'application/json',
        systemInstruction: {
          parts: [{
            text: `Você é um especialista em extração de dados de qualificação de leads. Analise a conversa e extraia as seguintes informações quando disponíveis:

CAMPOS OBRIGATÓRIOS:
- nome_completo: Nome completo da pessoa
- nome_empresa: Nome da empresa/organização
- como_conheceu_g4: Como a pessoa conheceu o G4 (Google, LinkedIn, indicação, etc.)
- faturamento_anual_aproximado: Faturamento anual da empresa (ex: "R$ 5.000.000")
- total_funcionarios_empresa: Número total de funcionários (número inteiro)
- setor_empresa: Setor/área de atuação da empresa
- principal_desafio: Principal desafio enfrentado pela empresa
- melhor_dia_contato_especialista: Melhor dia para contato (ex: "Terça-feira")
- melhor_horario_contato_especialista: Melhor horário para contato (ex: "10h")
- preferencia_contato_especialista: "Ligacao" ou "WhatsApp"
- telefone: Número de telefone
- qualificador_nome: Nome do qualificador (sempre "Mari")

INSTRUÇÕES:
1. Retorne APENAS um objeto JSON válido
2. Inclua apenas campos que foram mencionados na conversa
3. Para números de funcionários, use apenas números inteiros
4. Para telefone, mantenha o formato original mencionado
5. Seja preciso e não invente informações
6. Se uma informação foi mencionada de forma parcial ou ambígua, ainda assim a inclua

EXEMPLO DE RETORNO:
{
  "nome_completo": "João Silva",
  "nome_empresa": "Tech Solutions",
  "total_funcionarios_empresa": 50
}`
          }]
        },
      };

      const model = 'gemini-2.0-flash-lite';
      
      // Build conversation context
      const conversationText = conversationHistoryRef.current
        .map(turn => `${turn.speaker}: ${turn.text}`)
        .join('\n');

      console.log('Extracting qualification data from conversation:', conversationText);

      const contents = [
        {
          role: 'user',
          parts: [{ text: conversationText }],
        },
      ];

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      const responseText = response.text;
      console.log('Raw extraction response:', responseText);

      try {
        const extractedData = JSON.parse(responseText);
        console.log('Parsed qualification data:', extractedData);

        // Only update if we have new data
        const hasNewData = Object.keys(extractedData).some(key => 
          extractedData[key] !== lastExtractedDataRef.current[key as keyof QualificationData]
        );

        if (hasNewData) {
          lastExtractedDataRef.current = { ...lastExtractedDataRef.current, ...extractedData };
          onDataExtracted(extractedData);
        }

      } catch (parseError) {
        console.error('Error parsing qualification data JSON:', parseError, responseText);
      }

    } catch (error) {
      console.error('Error extracting qualification data:', error);
    }
  }, [apiKey]);

  const resetConversation = useCallback(() => {
    conversationHistoryRef.current = [];
    lastExtractedDataRef.current = {};
  }, []);

  return {
    extractQualificationData,
    resetConversation
  };
};

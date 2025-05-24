
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
  const processingRef = useRef<boolean>(false);

  const extractQualificationData = useCallback(async (
    newTurn: ConversationTurn,
    onDataExtracted: (data: Partial<QualificationData>) => void
  ) => {
    if (!apiKey) {
      console.warn('No API key provided for qualification extraction');
      return;
    }

    // Only extract from user messages, not from Mari or System messages
    if (newTurn.speaker !== "Usuário") {
      console.log('Skipping extraction for non-user message:', newTurn.speaker);
      return;
    }

    // Prevent concurrent extractions
    if (processingRef.current) {
      console.log('Extraction already in progress, skipping');
      return;
    }

    // Add new turn to conversation history
    conversationHistoryRef.current.push(newTurn);

    // Keep only last 15 turns to have more context but avoid token limits
    if (conversationHistoryRef.current.length > 15) {
      conversationHistoryRef.current = conversationHistoryRef.current.slice(-15);
    }

    // Only run extraction if we have meaningful user input
    const userMessage = newTurn.text.toLowerCase().trim();
    const greetingWords = ['oi', 'olá', 'hello', 'hi', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'e aí'];
    
    if (userMessage.length < 2 || greetingWords.some(greeting => userMessage.includes(greeting) && userMessage.length < 15)) {
      console.log('Skipping extraction for greeting or very short message:', userMessage);
      return;
    }

    processingRef.current = true;

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const config = {
        responseMimeType: 'application/json',
        systemInstruction: {
          parts: [{
            text: `Você é um especialista em extração de dados de qualificação de leads. Analise TODAS as mensagens do usuário na conversa e extraia as seguintes informações APENAS quando explicitamente mencionadas:

CAMPOS PARA EXTRAIR:
- nome_completo: Nome completo da pessoa (APENAS quando a pessoa se apresenta claramente)
- nome_empresa: Nome da empresa/organização (APENAS quando mencionado)
- como_conheceu_g4: Como a pessoa conheceu o G4 (Google, LinkedIn, indicação, etc.)
- faturamento_anual_aproximado: Faturamento anual da empresa (ex: "R$ 5.000.000", "5 milhões")
- total_funcionarios_empresa: Número total de funcionários (número inteiro)
- setor_empresa: Setor/área de atuação da empresa (ex: "tecnologia", "educação")
- principal_desafio: Principal desafio enfrentado pela empresa
- melhor_dia_contato_especialista: Melhor dia para contato (ex: "Terça-feira", "segunda")
- melhor_horario_contato_especialista: Melhor horário para contato (ex: "10h", "manhã")
- preferencia_contato_especialista: "Ligacao" ou "WhatsApp"
- telefone: Número de telefone (apenas números limpos)
- qualificador_nome: Nome do qualificador (sempre "Mari" quando há evidência de qualificação)

REGRAS CRÍTICAS:
1. Retorne APENAS um objeto JSON válido
2. Inclua apenas campos que foram EXPLICITAMENTE mencionados pelo USUÁRIO
3. NÃO extraia informações de mensagens do sistema ou do qualificador Mari
4. NÃO invente ou presuma informações
5. Para nomes, extraia apenas quando há apresentação clara (ex: "Meu nome é João", "Eu sou a Maria")
6. Para empresas, extraia apenas quando mencionado claramente (ex: "trabalho na Tech Corp", "minha empresa é ABC")
7. Seja MUITO conservador - é melhor não extrair nada do que extrair informações incorretas
8. Se não há informações novas claras, retorne um objeto vazio: {}
9. Para telefone, extraia apenas números, sem formatação

EXEMPLO DE CONVERSA E EXTRAÇÃO:
Usuário: "Oi, meu nome é João Silva"
Resposta: {"nome_completo": "João Silva"}

Usuário: "Trabalho na Tech Solutions, somos uma empresa de tecnologia"
Resposta: {"nome_empresa": "Tech Solutions", "setor_empresa": "tecnologia"}

Usuário: "Temos cerca de 50 funcionários"
Resposta: {"total_funcionarios_empresa": 50}`
          }]
        },
      };

      const model = 'gemini-2.0-flash-lite';
      
      // Build conversation context with ALL user messages
      const userMessages = conversationHistoryRef.current
        .filter(turn => turn.speaker === "Usuário")
        .map((turn, index) => `Mensagem ${index + 1}: ${turn.text}`)
        .join('\n');

      if (!userMessages.trim()) {
        console.log('No user messages to extract from');
        return;
      }

      console.log('Extracting qualification data from all user messages:', userMessages);

      const contents = [
        {
          role: 'user',
          parts: [{ text: `Analise todas essas mensagens do usuário e extraia informações de qualificação:\n\n${userMessages}` }],
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
        const extractedData = JSON.parse(responseText) as Partial<QualificationData>;
        console.log('Parsed qualification data:', extractedData);

        // Only proceed if we actually extracted some data
        if (Object.keys(extractedData).length === 0) {
          console.log('No data extracted, skipping update');
          return;
        }

        // Filter out data that we already have with the same value
        const newData: Partial<QualificationData> = {};
        let hasNewData = false;

        Object.entries(extractedData).forEach(([key, value]) => {
          const typedKey = key as keyof QualificationData;
          if (value && value !== lastExtractedDataRef.current[typedKey]) {
            (newData as any)[typedKey] = value;
            hasNewData = true;
          }
        });

        if (hasNewData) {
          console.log('New data detected:', newData);
          lastExtractedDataRef.current = { ...lastExtractedDataRef.current, ...newData };
          onDataExtracted(newData);
        } else {
          console.log('No new data detected, skipping update');
        }

      } catch (parseError) {
        console.error('Error parsing qualification data JSON:', parseError, responseText);
      }

    } catch (error) {
      console.error('Error extracting qualification data:', error);
    } finally {
      processingRef.current = false;
    }
  }, [apiKey]);

  const resetConversation = useCallback(() => {
    conversationHistoryRef.current = [];
    lastExtractedDataRef.current = {};
    processingRef.current = false;
  }, []);

  return {
    extractQualificationData,
    resetConversation
  };
};

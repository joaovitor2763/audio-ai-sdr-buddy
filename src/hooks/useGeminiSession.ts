
import { useRef, useCallback } from 'react';
import { GoogleGenAI, Session, Type, Modality, MediaResolution, LiveServerMessage, StartSensitivity, EndSensitivity, ActivityHandling, TurnCoverage } from '@google/genai';

interface GeminiSessionConfig {
  apiKey: string;
  onMessage: (message: LiveServerMessage) => void;
  onOpen: () => void;
  onError: (error: ErrorEvent) => void;
  onClose: (event: CloseEvent) => void;
}

export const useGeminiSession = () => {
  const geminiSessionRef = useRef<Session | null>(null);

  const createSession = useCallback(async (config: GeminiSessionConfig) => {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    const tools = [{
      functionDeclarations: [{
        name: 'send_qualification_webhook',
        description: 'Sends lead-qualification data from G4 Educacao Roteiro de Qualificacao to a webhook (e.g., Zapier).',
        parameters: {
          type: Type.OBJECT,
          required: ["webhook_url", "qualification_data"],
          properties: {
            webhook_url: {
              type: Type.STRING,
              description: "The URL of the webhook to send the data to.",
            },
            qualification_data: {
              type: Type.OBJECT,
              description: "Key information gathered during the qualification call.",
              required: ["nome_completo", "nome_empresa", "como_conheceu_g4", "faturamento_anual_aproximado", "total_funcionarios_empresa", "setor_empresa", "principal_desafio", "melhor_dia_contato_especialista", "melhor_horario_contato_especialista", "preferencia_contato_especialista", "telefone", "qualificador_nome"],
              properties: {
                nome_completo: { type: Type.STRING, description: "Nome completo do lead." },
                nome_empresa: { type: Type.STRING, description: "Nome da empresa." },
                como_conheceu_g4: { type: Type.STRING, description: "Como o lead conheceu o G4." },
                faturamento_anual_aproximado: { type: Type.STRING, description: "Faturamento anual aproximado (ex: R$ 5.000.000)." },
                total_funcionarios_empresa: { type: Type.INTEGER, description: "Total de funcionarios na empresa." },
                setor_empresa: { type: Type.STRING, description: "Setor de atuacao da empresa." },
                principal_desafio: { type: Type.STRING, description: "Principal desafio enfrentado pela empresa." },
                melhor_dia_contato_especialista: { type: Type.STRING, description: "Melhor dia para o especialista entrar em contato (ex: Terca-feira)." },
                melhor_horario_contato_especialista: { type: Type.STRING, description: "Melhor horario para contato (ex: 10h)." },
                preferencia_contato_especialista: { type: Type.STRING, description: "Canal de preferencia para contato do especialista.", enum: ["Ligacao", "WhatsApp"] },
                telefone: { type: Type.STRING, description: "Numero de telefone confirmado para contato." },
                qualificador_nome: { type: Type.STRING, description: "Nome do qualificador G4 que conduziu a ligacao (ex: Mari)." },
              },
            },
          },
        },
      }]
    }];

    const sessionConfig = {
      responseModalities: [Modality.AUDIO],
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Kore',
          }
        },
        // Set language to Portuguese for better transcription
        languageCode: 'pt-BR'
      },
      contextWindowCompression: {
        triggerTokens: "30000",
        slidingWindow: { targetTokens: "20000" },
      },
      tools,
      // Optimized transcription settings for Portuguese
      inputAudioTranscription: {
        enabled: true,
        mode: 'CONTINUOUS'
      },
      outputAudioTranscription: {
        enabled: true
      },
      // Improved activity detection settings
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_MEDIUM, // Changed from HIGH to MEDIUM
          prefixPaddingMs: 500, // Increased from 300 to better capture start of speech
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_MEDIUM, // Changed from HIGH to MEDIUM
          silenceDurationMs: 1500 // Increased from 1000 to reduce interruptions
        },
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY
      },
      systemInstruction: {
        parts: [{
          text: `Você é Mari, uma SDR (Sales Development Representative) especialista da G4 Educação, uma empresa brasileira que oferece cursos de capacitação profissional.

PERSONALIDADE:
- Simpática, profissional e empática
- Fala de forma natural e conversacional
- Usa português brasileiro
- Demonstra interesse genuíno pelo lead

OBJETIVO DA CALL:
Qualificar leads interessados em cursos da G4 Educação e agendar uma reunião com um especialista.

INFORMAÇÕES OBRIGATÓRIAS PARA COLETAR:
1. Nome da pessoa
2. Nome da empresa onde trabalha
3. Como conheceu a G4 Educação (Instagram, indicação, Google, etc.)
4. Faturamento anual aproximado da empresa
5. Total de funcionários da empresa
6. Setor de atuação da empresa
7. Principal desafio que a empresa enfrenta
8. Melhor dia para contato do especialista
9. Melhor horário para contato do especialista
10. Preferência de contato (WhatsApp, telefone, e-mail)
11. Telefone para contato

FLUXO DA CONVERSA:
1. Cumprimente de forma calorosa e se apresente
2. Faça perguntas abertas para coletar as informações necessárias
3. Seja natural na conversação, não siga uma ordem rígida das perguntas
4. Confirme informações importantes repetindo-as claramente
5. Quando tiver TODAS as 11 informações obrigatórias, finalize a call

FINALIZAÇÃO OBRIGATÓRIA:
Quando você tiver coletado TODAS as informações obrigatórias (1-11), você DEVE:
1. Agradecer o tempo dedicado
2. Confirmar que um especialista entrará em contato
3. Dizer "Muito obrigada e tchau! Vou desligar a call agora."
4. Esta frase exata é importante para o sistema processar a gravação

IMPORTANTE:
- Seja natural e conversacional
- Não seja robótica ou mecânica
- Adapte-se ao ritmo do lead
- Confirme informações importantes claramente
- Use a frase de finalização exata quando completar a qualificação
- Fale de forma clara e pausada para melhor compreensão

Após coletar as informações, use a tool com a function call send_qualification_webhook para enviar os dados, o url do webhook sempre é https://hooks.zapier.com/hooks/catch/9531377/2j18bjs/`
        }]
      },
    };

    const session = await ai.live.connect({
      model,
      callbacks: {
        onopen: config.onOpen,
        onmessage: config.onMessage,
        onerror: config.onError,
        onclose: config.onClose,
      },
      config: sessionConfig
    });

    geminiSessionRef.current = session;
    return session;
  }, []);

  const closeSession = useCallback(() => {
    if (geminiSessionRef.current) {
      geminiSessionRef.current.close();
      geminiSessionRef.current = null;
    }
  }, []);

  const sendToolResponse = useCallback((functionCalls: any[]) => {
    if (geminiSessionRef.current) {
      geminiSessionRef.current.sendToolResponse({
        functionResponses: functionCalls.map(functionCall => ({
          id: functionCall.id,
          name: functionCall.name,
          response: { result: 'success', message: 'Webhook triggered successfully' }
        }))
      });
    }
  }, []);

  return {
    createSession,
    closeSession,
    sendToolResponse,
    session: geminiSessionRef.current
  };
};

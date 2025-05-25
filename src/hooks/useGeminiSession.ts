
import { GoogleGenAI } from '@google/genai';

interface SessionConfig {
  apiKey: string;
  onMessage: (message: any) => void;
  onOpen?: () => void;
  onError?: (error: ErrorEvent) => void;
  onClose?: (event: CloseEvent) => void;
}

export const useGeminiSession = () => {
  let currentSession: any | null = null;

  const createSession = async (config: SessionConfig) => {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    
    const session = await ai.live.connect({
      model: 'gemini-2.0-flash-live-001',
      config: {
        responseModalities: ['audio'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede'
            }
          }
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
1. Nome completo da pessoa
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

FERRAMENTAS DISPONÍVEIS:
Use a função send_qualification_webhook APENAS quando tiver coletado informações suficientes para enviar ao CRM.

IMPORTANTE:
- Seja natural e conversacional
- Não seja robótica ou mecânica
- Adapte-se ao ritmo do lead
- Confirme informações importantes claramente
- Use a frase de finalização exata quando completar a qualificação`
          }]
        }
      },
      callbacks: {
        onopen: config.onOpen,
        onmessage: config.onMessage,
        onerror: config.onError,
        onclose: config.onClose
      }
    });

    currentSession = session;
    return session;
  };

  const closeSession = () => {
    if (currentSession) {
      currentSession.close();
      currentSession = null;
    }
  };

  const sendToolResponse = (functionCalls: any[]) => {
    if (currentSession) {
      const responses = functionCalls.map(call => ({
        id: call.id,
        response: { success: true }
      }));
      
      currentSession.sendToolResponse({ functionResponses: responses });
    }
  };

  return {
    createSession,
    closeSession,
    sendToolResponse
  };
};

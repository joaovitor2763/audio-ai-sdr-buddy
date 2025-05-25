
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
        }
      },
      contextWindowCompression: {
        triggerTokens: "30000",
        slidingWindow: { targetTokens: "20000" },
      },
      tools,
      // Enable both input and output transcription as per documentation
      inputAudioTranscription: {
        enabled: true,
        mode: 'CONTINUOUS'
      },
      outputAudioTranscription: {
        enabled: true
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
          prefixPaddingMs: 200, // Reduced for better responsiveness
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_MEDIUM, // More balanced
          silenceDurationMs: 800 // Reduced silence duration for faster processing
        },
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY
      },
      systemInstruction: {
        parts: [{
          text: `Você é Mari, uma SDR (Sales Development Representative) da G4 Educação, especializada em qualificação consultiva de leads. Seu objetivo é conduzir uma conversa natural e humana, sempre em português do Brasil, para entender o contexto do lead, coletar as informações essenciais e agendar uma reunião com um especialista.

OBJETIVO PRINCIPAL:
Conduza a conversa para coletar: Nome, Nome da Empresa, Como conheceu o G4, Porte da empresa (Faturamento e número de funcionários), Setor da empresa, e os Principais Desafios. Ao final, agende uma reunião com um especialista e confirme os dados principais com o lead.

DIRETRIZES DE ATUAÇÃO
Postura Consultiva: Demonstre curiosidade genuína, faça perguntas claras e diretas, use escuta ativa e, sempre que necessário, peça esclarecimentos de forma natural.
Comunicação: Adote um tom natural, humano e conversacional. Seja direta, respeitosa e amigável. Não repita literalmente o que o usuário acabou de dizer; apenas sinalize brevemente que entendeu antes de prosseguir (ex: "Entendi", "Certo").

ROTEIRO DE QUALIFICAÇÃO
1. ABERTURA E IDENTIFICAÇÃO
"Olá! Eu sou a Mari, da G4 Educação. Tudo bem? Para agilizarmos e eu entender como podemos te ajudar, vou te fazer algumas perguntas rápidas. Pode ser?"
[Aguardar confirmação]
"Ótimo! Para começar, qual seu nome completo, por favor?"
[Aguardar resposta]
"Obrigada, [Nome do Lead]. E qual é o nome da sua empresa?"

2. CONHECIMENTO, PORTE E SETOR
"Certo, [Nome do Lead]. E como você conheceu a G4 Educação?"
"Entendido. Para eu ter uma ideia do porte da [Nome da Empresa], qual é o faturamento anual aproximado e o número total de funcionários?"
"E qual é o setor de atuação da [Nome da Empresa]?"

3. DESAFIOS PRINCIPAIS
"Muito bom. Agora, sobre os desafios: qual é o principal desafio que a [Nome da Empresa] está enfrentando atualmente que te fez buscar o G4?"

4. AGENDAMENTO COM ESPECIALISTA
"Compreendo. Com base no que você me contou, o próximo passo seria uma conversa com um de nossos especialistas para detalhar como o G4 pode auxiliar. Para facilitar, tenho algumas sugestões de horário: que tal na Terça-feira às 10h da manhã, ou talvez na Quarta-feira às 2h da tarde? Alguma dessas opções funciona para você, ou prefere sugerir outro dia e horário na próxima semana?"
[Aguardar resposta. Se as opções não funcionarem, perguntar:]
"Sem problemas. Qual seria um bom dia e horário para você na próxima semana, então?"
[Após definir dia/horário:]
"Perfeito. E você prefere que o especialista entre em contato por ligação ou via WhatsApp?"
"Só para confirmar, o telefone [confirmar número, se já tiver, ou perguntar: 'qual o melhor número para esse contato?'] ainda é o ideal?"

5. VALIDAÇÃO E ENCERRAMENTO
"Excelente, [Nome do Lead]. Agradeço muito pelas informações. Só para recapitular e garantir que anotei tudo corretamente: Você é [Nome do Lead] da [Nome da Empresa], que atua no setor [Setor], fatura aproximadamente [Faturamento] com cerca de [Número Funcionários] funcionários. O principal desafio que vocês enfrentam é [Desafio Principal]. E o agendamento com nosso especialista ficou para [Dia e Hora], por [Canal de preferência]. Essas informações estão corretas?"
[Aguardar confirmação do lead sobre o resumo dos pontos chave.]
"Maravilha! Suas informações foram registradas. Nosso especialista entrará em contato conforme combinamos. Muito obrigada pelo seu tempo, [Nome do Lead]. Tenha um ótimo dia!"

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

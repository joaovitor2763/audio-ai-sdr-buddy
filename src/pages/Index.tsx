import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mic, MicOff, Phone, PhoneOff, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AudioVisualizer from "@/components/AudioVisualizer";
import CallTranscript from "@/components/CallTranscript";
import QualificationStatus from "@/components/QualificationStatus";
import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality, Session, Type } from '@google/genai';
import { useAudioProcessor } from "@/hooks/useAudioProcessor";
import { useQualificationExtractor } from "@/hooks/useQualificationExtractor";

const Index = () => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState<Array<{speaker: string, text: string, timestamp: Date}>>([]);
  const [qualificationData, setQualificationData] = useState({
    nome_completo: "",
    nome_empresa: "",
    como_conheceu_g4: "",
    faturamento_anual_aproximado: "",
    total_funcionarios_empresa: 0,
    setor_empresa: "",
    principal_desafio: "",
    melhor_dia_contato_especialista: "",
    melhor_horario_contato_especialista: "",
    preferencia_contato_especialista: "",
    telefone: "",
    qualificador_nome: "Mari",
  });
  const [extractionLog, setExtractionLog] = useState<Array<{field: string, value: any, timestamp: Date}>>([]);
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Enhanced refs for better transcription management
  const pendingUserTranscriptRef = useRef<string>("");
  const pendingAiTranscriptRef = useRef<string>("");
  const isUserTurnRef = useRef(false);
  const isAiTurnRef = useRef(false);
  const userTranscriptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptBufferRef = useRef<string>("");
  
  const geminiSessionRef = useRef<Session | null>(null);
  const audioContextPlaybackRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const { toast } = useToast();
  const { startAudioProcessing, stopAudioProcessing, toggleMute: toggleAudioMute } = useAudioProcessor();
  const { extractQualificationData, resetConversation } = useQualificationExtractor(apiKey);

  // Audio buffer configuration
  const BUFFER_SIZE = 8;
  const CHUNK_DELAY = 150;
  const TRANSCRIPT_FINALIZATION_DELAY = 2000; // Wait 2 seconds before finalizing user transcript

  useEffect(() => {
    // Simulated audio level for visualization
    let interval: NodeJS.Timeout;
    if (isCallActive && !isMuted) {
      interval = setInterval(() => {
        setAudioLevel(Math.random() * 100);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isCallActive, isMuted]);

  const addToTranscript = (speaker: string, text: string) => {
    const newEntry = { speaker, text, timestamp: new Date() };
    setTranscript(prev => [...prev, newEntry]);
    
    // Only extract qualification data from complete user turns
    if (speaker === "Usuário" && text.trim().length > 0) {
      console.log("Processing complete user turn for extraction:", text);
      extractQualificationData(newEntry, updateQualificationData);
    }
  };

  const updateQualificationData = (data: Partial<typeof qualificationData>) => {
    console.log("Updating qualification data:", data);
    
    // Log what was extracted
    Object.entries(data).forEach(([field, value]) => {
      if (value && value !== "" && value !== 0) {
        setExtractionLog(prev => [...prev, { field, value, timestamp: new Date() }]);
      }
    });
    
    setQualificationData(prev => ({ ...prev, ...data }));
    
    // Add to transcript to show what was extracted
    const extractedInfo = Object.entries(data)
      .filter(([_, value]) => value && value !== "" && value !== 0)
      .map(([key, value]) => {
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `${key}: ${stringValue}`;
      })
      .join(", ");
    
    if (extractedInfo) {
      addToTranscript("System", `✅ Dados extraídos: ${extractedInfo}`);
    }
  };

  // Utility functions for audio processing
  const decode = (base64Data: string): ArrayBuffer => {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const decodeAudioData = async (
    arrayBuffer: ArrayBuffer,
    audioContext: AudioContext,
    sampleRate: number,
    channels: number
  ): Promise<AudioBuffer> => {
    const numSamples = arrayBuffer.byteLength / 2;
    const audioBuffer = audioContext.createBuffer(channels, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    const dataView = new DataView(arrayBuffer);
    for (let i = 0; i < numSamples; i++) {
      const sample = dataView.getInt16(i * 2, true);
      channelData[i] = sample / 32768.0;
    }
    
    return audioBuffer;
  };

  const handleAudioMessage = async (inlineData: any) => {
    try {
      console.log("Processing audio chunk, mime:", inlineData.mimeType, "size:", inlineData.data?.length);
      
      if (!audioContextPlaybackRef.current) {
        console.log("Creating new AudioContext for playback");
        audioContextPlaybackRef.current = new AudioContext({ sampleRate: 24000 });
      }

      if (audioContextPlaybackRef.current.state === 'suspended') {
        console.log("Resuming suspended AudioContext");
        await audioContextPlaybackRef.current.resume();
      }

      // Decode audio data
      const audioBuffer = await decodeAudioData(
        decode(inlineData.data),
        audioContextPlaybackRef.current,
        24000,
        1
      );

      // Calculate next start time similar to the working example
      nextStartTimeRef.current = Math.max(
        nextStartTimeRef.current,
        audioContextPlaybackRef.current.currentTime
      );

      // Create and configure audio source
      const source = audioContextPlaybackRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextPlaybackRef.current.destination);
      
      // Track sources and clean up when finished
      source.addEventListener('ended', () => {
        audioSourcesRef.current.delete(source);
        console.log(`Audio source ended, remaining sources: ${audioSourcesRef.current.size}`);
      });

      // Start playback at scheduled time
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
      audioSourcesRef.current.add(source);
      
      console.log(`Audio scheduled to start at ${nextStartTimeRef.current}, duration: ${audioBuffer.duration}s`);
      
    } catch (error) {
      console.error("Error processing audio:", error);
    }
  };

  // Enhanced function to finalize user transcript with timeout
  const finalizeUserTranscript = () => {
    if (pendingUserTranscriptRef.current.trim()) {
      console.log("Finalizing user transcript:", pendingUserTranscriptRef.current);
      addToTranscript("Usuário", pendingUserTranscriptRef.current.trim());
      pendingUserTranscriptRef.current = "";
      isUserTurnRef.current = false;
    }
  };

  const handleModelTurn = (message: LiveServerMessage) => {
    console.log("Received message:", message);

    // Handle interruption - stop all current audio sources
    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
      console.log("Handling interruption, stopping all audio sources");
      for (const source of audioSourcesRef.current.values()) {
        try {
          source.stop();
        } catch (e) {
          console.warn("Error stopping audio source:", e);
        }
        audioSourcesRef.current.delete(source);
      }
      nextStartTimeRef.current = 0;
      
      // Clear any pending user transcript timeout
      if (userTranscriptTimeoutRef.current) {
        clearTimeout(userTranscriptTimeoutRef.current);
        userTranscriptTimeoutRef.current = null;
      }
      
      // If user was interrupted, finalize their transcript
      if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
        console.log("Finalizing interrupted user transcript:", pendingUserTranscriptRef.current);
        finalizeUserTranscript();
      }
    }

    if (message.toolCall) {
      message.toolCall.functionCalls?.forEach(functionCall => {
        console.log(`Execute function ${functionCall.name} with arguments:`, functionCall.args);
        
        if (functionCall.name === 'send_qualification_webhook') {
          const args = functionCall.args as any;
          if (args.qualification_data) {
            updateQualificationData(args.qualification_data);
            triggerWebhook(args.qualification_data);
          }
        }
      });

      geminiSessionRef.current?.sendToolResponse({
        functionResponses: message.toolCall.functionCalls?.map(functionCall => ({
          id: functionCall.id,
          name: functionCall.name,
          response: { result: 'success', message: 'Webhook triggered successfully' }
        })) ?? []
      });
    }

    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      if (part?.inlineData && part.inlineData.mimeType?.includes('audio')) {
        // Mark AI turn as active
        isAiTurnRef.current = true;
        handleAudioMessage(part.inlineData);
      }

      if (part?.text) {
        console.log("Mari text:", part.text);
        // Accumulate AI text
        pendingAiTranscriptRef.current += part.text;
      }
    }

    // Enhanced user input transcription handling
    if (message.serverContent?.inputTranscription) {
      const transcriptText = message.serverContent.inputTranscription.text || "";
      const isEndOfSpeech = message.serverContent.inputTranscription.endOfSpeech;
      
      console.log("User transcript (tentative):", transcriptText, "endOfSpeech:", isEndOfSpeech);
      
      // Update the pending transcript
      pendingUserTranscriptRef.current = transcriptText;
      isUserTurnRef.current = true;
      
      // Clear any existing timeout
      if (userTranscriptTimeoutRef.current) {
        clearTimeout(userTranscriptTimeoutRef.current);
      }
      
      // If this is marked as end of speech, finalize immediately
      if (isEndOfSpeech) {
        console.log("End of speech detected, finalizing transcript immediately");
        finalizeUserTranscript();
      } else {
        // Otherwise, set a timeout to finalize the transcript if no more input comes
        userTranscriptTimeoutRef.current = setTimeout(() => {
          console.log("Transcript timeout reached, finalizing user input");
          finalizeUserTranscript();
        }, TRANSCRIPT_FINALIZATION_DELAY);
      }
    }

    // Handle turn completion
    if (message.serverContent?.turnComplete) {
      console.log("Turn completed");
      
      // Clear any pending transcript timeout
      if (userTranscriptTimeoutRef.current) {
        clearTimeout(userTranscriptTimeoutRef.current);
        userTranscriptTimeoutRef.current = null;
      }
      
      // Finalize AI transcript if there was one
      if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
        console.log("Finalizing AI transcript:", pendingAiTranscriptRef.current);
        addToTranscript("Mari", pendingAiTranscriptRef.current.trim());
        pendingAiTranscriptRef.current = "";
        isAiTurnRef.current = false;
      }
      
      // Finalize user transcript if there was one
      if (isUserTurnRef.current && pendingUserTranscriptRef.current.trim()) {
        console.log("Finalizing user transcript on turn complete:", pendingUserTranscriptRef.current);
        finalizeUserTranscript();
      }
    }

    // Handle generation complete (for AI responses)
    if (message.serverContent?.generationComplete) {
      console.log("Generation completed");
      
      // Finalize AI transcript if there was one
      if (isAiTurnRef.current && pendingAiTranscriptRef.current.trim()) {
        console.log("Finalizing AI transcript on generation complete:", pendingAiTranscriptRef.current);
        addToTranscript("Mari", pendingAiTranscriptRef.current.trim());
        pendingAiTranscriptRef.current = "";
        isAiTurnRef.current = false;
      }
    }
  };

  const startCall = async () => {
    if (!apiKey) {
      toast({
        title: "API Key Required",
        description: "Please enter your Gemini API key to start the call",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsConnecting(true);
      
      // Initialize audio context early
      if (!audioContextPlaybackRef.current) {
        console.log("Creating initial AudioContext");
        audioContextPlaybackRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      if (audioContextPlaybackRef.current.state === 'suspended') {
        await audioContextPlaybackRef.current.resume();
        console.log("AudioContext resumed for playback");
      }

      // Initialize next start time
      nextStartTimeRef.current = audioContextPlaybackRef.current.currentTime;
      
      // Clear audio sources
      audioSourcesRef.current.clear();
      
      resetConversation();
      
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const model = 'models/gemini-2.5-flash-preview-native-audio-dialog';

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

      const config = {
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
        inputAudioTranscription: {
          enabled: true,
          mode: 'CONTINUOUS'
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
          onopen: function () {
            console.log('Gemini Live session opened');
            addToTranscript("System", "Connected to Gemini Live API");
          },
          onmessage: function (message: LiveServerMessage) {
            handleModelTurn(message);
          },
          onerror: function (e: ErrorEvent) {
            console.error('Gemini Live error:', e.message);
            addToTranscript("System", `Error: ${e.message}`);
          },
          onclose: function (e: CloseEvent) {
            console.log('Gemini Live session closed:', e.reason);
            addToTranscript("System", "Session ended");
          },
        },
        config
      });

      geminiSessionRef.current = session;
      await startAudioProcessing(session, setAudioLevel);
      
      setIsCallActive(true);
      setIsConnecting(false);
      
      toast({
        title: "Call Started",
        description: "Mari is ready to help with your qualification",
      });
      
    } catch (error) {
      console.error("Error starting call:", error);
      setIsConnecting(false);
      toast({
        title: "Error",
        description: "Failed to start the call. Please check your API key and microphone permissions.",
        variant: "destructive",
      });
    }
  };

  const endCall = () => {
    // Clear any pending transcript timeout
    if (userTranscriptTimeoutRef.current) {
      clearTimeout(userTranscriptTimeoutRef.current);
      userTranscriptTimeoutRef.current = null;
    }
    
    stopAudioProcessing();
    
    // Stop all audio sources
    for (const source of audioSourcesRef.current.values()) {
      try {
        source.stop();
      } catch (e) {
        console.warn("Error stopping audio source:", e);
      }
    }
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    resetConversation();
    
    if (geminiSessionRef.current) {
      geminiSessionRef.current.close();
    }

    setIsCallActive(false);
    setIsMuted(false);
    setAudioLevel(0);
    
    toast({
      title: "Call Ended",
      description: "Thank you for the qualification call",
    });
  };

  const toggleMute = () => {
    toggleAudioMute(isMuted);
    setIsMuted(!isMuted);
  };

  const triggerWebhook = async (data?: any) => {
    try {
      const webhookUrl = "https://hooks.zapier.com/hooks/catch/9531377/2j18bjs/";
      const payload = data || qualificationData;
      
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        mode: "no-cors",
        body: JSON.stringify({
          webhook_url: webhookUrl,
          qualification_data: payload,
          timestamp: new Date().toISOString(),
        }),
      });

      toast({
        title: "Qualification Completed",
        description: "Lead information has been sent to the CRM system",
      });
      
      addToTranscript("System", "Qualification data has been successfully submitted to the CRM system.");
      
    } catch (error) {
      console.error("Error triggering webhook:", error);
      toast({
        title: "Error",
        description: "Failed to submit qualification data",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Voice SDR - G4 Educação</h1>
          <p className="text-xl text-gray-600">AI-Powered Lead Qualification System</p>
        </div>

        {!isCallActive && (
          <Card className="max-w-md mx-auto mb-8">
            <CardHeader>
              <CardTitle>Setup Call</CardTitle>
              <CardDescription>Enter your Gemini API key to start qualification</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="apiKey">Gemini API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="Enter your API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <Button 
                onClick={startCall} 
                className="w-full" 
                size="lg"
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Activity className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Phone className="mr-2 h-4 w-4" />
                    Start Qualification Call
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {isCallActive && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Call Controls */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-green-500" />
                    Call Active
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AudioVisualizer isActive={isCallActive && !isMuted} audioLevel={audioLevel} />
                  
                  <div className="flex gap-2">
                    <Button
                      onClick={toggleMute}
                      variant={isMuted ? "destructive" : "secondary"}
                      size="lg"
                      className="flex-1"
                    >
                      {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                    <Button onClick={endCall} variant="destructive" size="lg" className="flex-1">
                      <PhoneOff className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div className="text-center">
                    <Badge variant={isMuted ? "destructive" : "default"}>
                      {isMuted ? "Muted" : "Live"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-6">
                <QualificationStatus 
                  data={qualificationData} 
                  extractionLog={extractionLog}
                />
              </div>
            </div>

            {/* Transcript */}
            <div className="lg:col-span-2">
              <CallTranscript transcript={transcript} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;

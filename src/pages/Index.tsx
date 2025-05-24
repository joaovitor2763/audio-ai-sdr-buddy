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
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  
  const geminiSessionRef = useRef<Session | null>(null);
  const audioContextPlaybackRef = useRef<AudioContext | null>(null);
  const responseQueueRef = useRef<LiveServerMessage[]>([]);
  
  const { toast } = useToast();
  const { startAudioProcessing, stopAudioProcessing, toggleMute: toggleAudioMute } = useAudioProcessor();

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
    setTranscript(prev => [...prev, { speaker, text, timestamp: new Date() }]);
  };

  const updateQualificationData = (data: Partial<typeof qualificationData>) => {
    setQualificationData(prev => ({ ...prev, ...data }));
  };

  const handleAudioMessage = async (inlineData: any) => {
    try {
      console.log("Processing audio message with mime type:", inlineData.mimeType);
      console.log("Audio data length:", inlineData.data?.length);
      
      // Ensure we have a running AudioContext
      if (!audioContextPlaybackRef.current || audioContextPlaybackRef.current.state === 'closed') {
        console.log("Creating new AudioContext for playback");
        audioContextPlaybackRef.current = new AudioContext({ sampleRate: 24000 });
      }

      // Ensure AudioContext is resumed and running
      if (audioContextPlaybackRef.current.state === 'suspended') {
        console.log("Resuming suspended AudioContext");
        await audioContextPlaybackRef.current.resume();
      }

      console.log("AudioContext state:", audioContextPlaybackRef.current.state);
      console.log("AudioContext sample rate:", audioContextPlaybackRef.current.sampleRate);

      // The audio data from Gemini Live API is base64 encoded PCM
      const audioData = atob(inlineData.data);
      const audioBytes = new Uint8Array(audioData.length);
      
      for (let i = 0; i < audioData.length; i++) {
        audioBytes[i] = audioData.charCodeAt(i);
      }

      console.log("Decoded audio bytes length:", audioBytes.length);

      // Convert PCM data to AudioBuffer
      // The API returns 24kHz, 16-bit PCM, mono
      const sampleRate = 24000;
      const channels = 1;
      const bytesPerSample = 2; // 16-bit
      const numSamples = audioBytes.length / bytesPerSample;
      
      console.log("Number of samples:", numSamples);
      console.log("Expected duration:", numSamples / sampleRate, "seconds");

      if (numSamples === 0) {
        console.warn("No audio samples to play");
        return;
      }

      const audioBuffer = audioContextPlaybackRef.current.createBuffer(channels, numSamples, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      
      // Convert 16-bit PCM to float32
      const dataView = new DataView(audioBytes.buffer);
      let maxSample = 0;
      for (let i = 0; i < numSamples; i++) {
        const sample = dataView.getInt16(i * 2, true); // little-endian
        const floatSample = sample / 32768.0; // Convert to -1.0 to 1.0 range
        channelData[i] = floatSample;
        maxSample = Math.max(maxSample, Math.abs(floatSample));
      }

      console.log("Max sample value:", maxSample);
      console.log("Audio buffer created - duration:", audioBuffer.duration, "seconds");

      // Create and configure audio source
      const source = audioContextPlaybackRef.current.createBufferSource();
      source.buffer = audioBuffer;
      
      // Add gain node for volume control and debugging
      const gainNode = audioContextPlaybackRef.current.createGain();
      gainNode.gain.value = 2.0; // Increase volume to ensure it's audible
      
      // Connect: source -> gain -> destination
      source.connect(gainNode);
      gainNode.connect(audioContextPlaybackRef.current.destination);

      // Add event listeners for debugging
      source.onended = () => {
        console.log("Audio playback ended for chunk with max sample:", maxSample);
      };

      // Start playback immediately
      source.start(0);
      
      console.log("Audio playback started immediately");
      console.log("AudioContext destination maxChannelCount:", audioContextPlaybackRef.current.destination.maxChannelCount);
      console.log("Audio chunk queued successfully with gain:", gainNode.gain.value);
      
    } catch (error) {
      console.error("Error playing audio:", error);
      console.error("Audio data length:", inlineData.data?.length);
      console.error("MIME type:", inlineData.mimeType);
      console.error("AudioContext state:", audioContextPlaybackRef.current?.state);
    }
  };

  const handleModelTurn = (message: LiveServerMessage) => {
    console.log("Received message:", message);

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
        handleAudioMessage(part.inlineData);
      }

      if (part?.text) {
        console.log("Mari:", part.text);
        addToTranscript("Mari", part.text);
      }
    }

    if (message.serverContent?.inputTranscription) {
      console.log("User transcript:", message.serverContent.inputTranscription.text);
      addToTranscript("Usuário", message.serverContent.inputTranscription.text || "");
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
      
      // Initialize audio context early and ensure it's running
      if (!audioContextPlaybackRef.current) {
        console.log("Creating initial AudioContext");
        audioContextPlaybackRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      // Resume audio context if suspended
      if (audioContextPlaybackRef.current.state === 'suspended') {
        await audioContextPlaybackRef.current.resume();
        console.log("AudioContext resumed for playback");
      }

      console.log("Initial AudioContext state:", audioContextPlaybackRef.current.state);
      
      // Initialize Google GenAI
      const ai = new GoogleGenAI({
        apiKey: apiKey,
      });

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
        inputAudioTranscription: {},
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

      // Connect to Gemini Live API
      const session = await ai.live.connect({
        model,
        callbacks: {
          onopen: function () {
            console.log('Gemini Live session opened');
            addToTranscript("System", "Connected to Gemini Live API");
          },
          onmessage: function (message: LiveServerMessage) {
            responseQueueRef.current.push(message);
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

      // Start audio processing with the new AudioWorklet approach
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
    // Stop audio processing
    stopAudioProcessing();
    
    // Close Gemini session
    if (geminiSessionRef.current) {
      geminiSessionRef.current.close();
    }

    // Keep AudioContext alive but reset state
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
                <QualificationStatus data={qualificationData} />
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

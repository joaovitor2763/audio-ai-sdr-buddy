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
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const responseQueueRef = useRef<LiveServerMessage[]>([]);
  const currentUserTranscriptRef = useRef<string>("");
  
  const { toast } = useToast();
  const { startAudioProcessing, stopAudioProcessing, toggleMute: toggleAudioMute } = useAudioProcessor();

  // Enhanced audio buffering configuration for smoother playback
  const BUFFER_SIZE = 30; // Wait for 30 chunks before starting playback (doubled from 15)
  const CHUNK_DELAY = 200; // 200ms delay between chunks for much smoother playback (increased from 100ms)

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

  // Enhanced qualification data extraction from user responses
  const extractQualificationFromTranscript = (userText: string) => {
    const text = userText.toLowerCase();
    const updates: Partial<typeof qualificationData> = {};

    // Extract name patterns
    if (text.includes("meu nome") || text.includes("eu sou") || text.includes("me chamo")) {
      const nameMatch = userText.match(/(?:meu nome (?:é|eh)|eu sou|me chamo)\s+([a-záàâãéèêíìîóòôõúùû\s]+)/i);
      if (nameMatch) {
        updates.nome_completo = nameMatch[1].trim();
      }
    }

    // Extract company name
    if (text.includes("empresa") || text.includes("trabalho") || text.includes("companhia")) {
      const companyMatch = userText.match(/(?:empresa|trabalho|companhia)(?:\s+(?:é|eh|se chama))?\s+([a-záàâãéèêíìîóòôõúùû\s&\-\.]+)/i);
      if (companyMatch) {
        updates.nome_empresa = companyMatch[1].trim();
      }
    }

    // Extract how they found G4
    if (text.includes("conheci") || text.includes("soube") || text.includes("encontrei")) {
      const foundMatch = userText.match(/(?:conheci|soube|encontrei)(?:\s+(?:o|a))?\s+g4\s+(.+)/i);
      if (foundMatch) {
        updates.como_conheceu_g4 = foundMatch[1].trim();
      }
    }

    // Extract revenue information
    if (text.includes("faturamento") || text.includes("receita") || text.includes("r$") || text.includes("milhões") || text.includes("milhoes")) {
      const revenueMatch = userText.match(/(r\$\s*[\d.,]+(?:\s*(?:milhões|milhoes|mil))?|[\d.,]+\s*(?:milhões|milhoes|mil))/i);
      if (revenueMatch) {
        updates.faturamento_anual_aproximado = revenueMatch[1].trim();
      }
    }

    // Extract number of employees
    if (text.includes("funcionários") || text.includes("funcionarios") || text.includes("pessoas") || text.includes("colaboradores")) {
      const employeesMatch = userText.match(/([\d]+)(?:\s*(?:funcionários|funcionarios|pessoas|colaboradores))?/i);
      if (employeesMatch) {
        updates.total_funcionarios_empresa = parseInt(employeesMatch[1]);
      }
    }

    // Extract sector
    if (text.includes("setor") || text.includes("área") || text.includes("area") || text.includes("ramo")) {
      const sectorMatch = userText.match(/(?:setor|área|area|ramo)(?:\s+(?:é|eh|de))?\s+([a-záàâãéèêíìîóòôõúùû\s]+)/i);
      if (sectorMatch) {
        updates.setor_empresa = sectorMatch[1].trim();
      }
    }

    // Extract phone number
    const phoneMatch = userText.match(/(\(?[\d\s\-\(\)]{10,}\)?)/);
    if (phoneMatch) {
      updates.telefone = phoneMatch[1].trim();
    }

    // Update qualification data if we found anything
    if (Object.keys(updates).length > 0) {
      console.log("Extracted qualification data:", updates);
      updateQualificationData(updates);
    }
  };

  const playNextAudioChunk = () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current) {
      return;
    }

    // Wait for larger buffer to fill up before starting playback
    if (audioQueueRef.current.length < BUFFER_SIZE && audioQueueRef.current.length > 0) {
      console.log(`Waiting for buffer to fill: ${audioQueueRef.current.length}/${BUFFER_SIZE} chunks`);
      setTimeout(() => playNextAudioChunk(), 100);
      return;
    }

    const audioBuffer = audioQueueRef.current.shift();
    if (!audioBuffer || !audioContextPlaybackRef.current) {
      return;
    }

    isPlayingRef.current = true;

    try {
      const source = audioContextPlaybackRef.current.createBufferSource();
      source.buffer = audioBuffer;
      
      const gainNode = audioContextPlaybackRef.current.createGain();
      gainNode.gain.value = 2.0;
      
      source.connect(gainNode);
      gainNode.connect(audioContextPlaybackRef.current.destination);

      source.onended = () => {
        console.log(`Audio chunk finished, queue remaining: ${audioQueueRef.current.length}, scheduling next with ${CHUNK_DELAY}ms delay`);
        isPlayingRef.current = false;
        // Increased delay between chunks for smoother playback
        setTimeout(() => playNextAudioChunk(), CHUNK_DELAY);
      };

      source.start(0);
      console.log(`Playing buffered audio chunk, duration: ${audioBuffer.duration}s, queue length: ${audioQueueRef.current.length}`);
      
    } catch (error) {
      console.error("Error playing audio chunk:", error);
      isPlayingRef.current = false;
      setTimeout(() => playNextAudioChunk(), 100);
    }
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

      const audioData = atob(inlineData.data);
      const audioBytes = new Uint8Array(audioData.length);
      
      for (let i = 0; i < audioData.length; i++) {
        audioBytes[i] = audioData.charCodeAt(i);
      }

      const sampleRate = 24000;
      const channels = 1;
      const bytesPerSample = 2;
      const numSamples = audioBytes.length / bytesPerSample;

      if (numSamples === 0) {
        console.warn("No audio samples to play");
        return;
      }

      const audioBuffer = audioContextPlaybackRef.current.createBuffer(channels, numSamples, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      
      const dataView = new DataView(audioBytes.buffer);
      for (let i = 0; i < numSamples; i++) {
        const sample = dataView.getInt16(i * 2, true);
        const floatSample = sample / 32768.0;
        channelData[i] = floatSample;
      }

      // Add to queue
      audioQueueRef.current.push(audioBuffer);
      console.log("Audio chunk added to queue. Queue length:", audioQueueRef.current.length, "Buffer threshold:", BUFFER_SIZE);
      
      // Start playing if not already playing and we have enough buffer
      if (!isPlayingRef.current && audioQueueRef.current.length >= BUFFER_SIZE) {
        console.log("Starting audio playback with buffer of", audioQueueRef.current.length, "chunks");
        playNextAudioChunk();
      }
      
    } catch (error) {
      console.error("Error processing audio:", error);
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
      const transcriptText = message.serverContent.inputTranscription.text || "";
      console.log("User transcript:", transcriptText);
      
      // Accumulate user transcript for better extraction
      currentUserTranscriptRef.current += " " + transcriptText;
      
      addToTranscript("Usuário", transcriptText);
      
      // Extract qualification data from user responses
      extractQualificationFromTranscript(currentUserTranscriptRef.current);
      
      // Reset accumulated transcript after processing
      if (transcriptText.includes('.') || transcriptText.includes('?') || transcriptText.includes('!')) {
        currentUserTranscriptRef.current = "";
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
      
      // Reset audio queue and user transcript
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      currentUserTranscriptRef.current = "";
      
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
    
    // Clear audio queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    
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

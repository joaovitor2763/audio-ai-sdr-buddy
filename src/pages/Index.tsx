
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
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const { toast } = useToast();

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
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      audioStreamRef.current = stream;
      
      // Setup audio visualization
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      // Setup MediaRecorder for audio capture
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          // Convert to base64 and send to Gemini API
          const reader = new FileReader();
          reader.onload = () => {
            const base64Data = (reader.result as string).split(',')[1];
            wsRef.current?.send(JSON.stringify({
              type: 'audio',
              data: base64Data,
              mimeType: 'audio/webm'
            }));
          };
          reader.readAsDataURL(event.data);
        }
      };
      
      // Start recording
      mediaRecorderRef.current.start(100); // Send data every 100ms
      
      setIsCallActive(true);
      setIsConnecting(false);
      
      // Add initial message from Mari
      addToTranscript("Mari", "Olá! Eu sou a Mari, da G4 Educação. Tudo bem? Para agilizarmos e eu entender como podemos te ajudar, vou te fazer algumas perguntas rápidas. Pode ser?");
      
      toast({
        title: "Call Started",
        description: "Mari is ready to help with your qualification",
      });
      
    } catch (error) {
      console.error("Error starting call:", error);
      setIsConnecting(false);
      toast({
        title: "Error",
        description: "Failed to start the call. Please check your microphone permissions.",
        variant: "destructive",
      });
    }
  };

  const endCall = () => {
    // Stop recording
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    // Stop audio stream
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    setIsCallActive(false);
    setIsMuted(false);
    setAudioLevel(0);
    
    // Simulate qualification completion
    setTimeout(() => {
      if (qualificationData.nome_completo) {
        triggerWebhook();
      }
    }, 1000);
    
    toast({
      title: "Call Ended",
      description: "Thank you for the qualification call",
    });
  };

  const toggleMute = () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  const triggerWebhook = async () => {
    try {
      const webhookUrl = "https://hooks.zapier.com/hooks/catch/9531377/2j18bjs/";
      
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        mode: "no-cors",
        body: JSON.stringify({
          webhook_url: webhookUrl,
          qualification_data: qualificationData,
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

  // Simulate receiving responses from Mari (in a real implementation, this would come from the Gemini API)
  const simulateAIResponse = (userInput: string) => {
    setTimeout(() => {
      let response = "";
      
      if (userInput.toLowerCase().includes("sim") || userInput.toLowerCase().includes("pode")) {
        response = "Ótimo! Para começar, qual seu nome completo, por favor?";
      } else if (userInput.includes("João") || userInput.includes("Maria")) {
        response = `Obrigada, ${userInput}. E qual é o nome da sua empresa?`;
        updateQualificationData({ nome_completo: userInput });
      } else if (userInput.toLowerCase().includes("tecnologia") || userInput.toLowerCase().includes("empresa")) {
        response = "Certo. E como você conheceu a G4 Educação?";
        updateQualificationData({ nome_empresa: userInput });
      }
      
      if (response) {
        addToTranscript("Mari", response);
      }
    }, 1500);
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
              <CallTranscript 
                transcript={transcript} 
                onUserInput={simulateAIResponse}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;

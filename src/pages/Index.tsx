import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import CallSetup from "@/components/CallSetup";
import CallControls from "@/components/CallControls";
import CallTranscript from "@/components/CallTranscript";
import QualificationStatus from "@/components/QualificationStatus";
import { LiveServerMessage } from '@google/genai';
import { useAudioProcessor } from "@/hooks/useAudioProcessor";
import { useQualificationExtractor } from "@/hooks/useQualificationExtractor";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useTranscriptManager } from "@/hooks/useTranscriptManager";
import { useGeminiSession } from "@/hooks/useGeminiSession";
import { triggerWebhook } from "@/utils/webhookUtils";

const Index = () => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
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
  
  const { toast } = useToast();
  const { startAudioProcessing, stopAudioProcessing, toggleMute: toggleAudioMute } = useAudioProcessor();
  const { extractQualificationData, resetConversation } = useQualificationExtractor(apiKey);
  const { initializeAudioContext, handleAudioMessage, stopAllAudio, resetAudio } = useAudioPlayback();
  const { 
    transcript, 
    addToTranscript, 
    handleUserTranscript, 
    handleAiTranscript, 
    handleInterruption, 
    handleTurnComplete, 
    handleGenerationComplete, 
    clearTranscripts 
  } = useTranscriptManager();
  const { createSession, closeSession, sendToolResponse } = useGeminiSession();

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCallActive && !isMuted) {
      interval = setInterval(() => {
        setAudioLevel(Math.random() * 100);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isCallActive, isMuted]);

  const updateQualificationData = (data: Partial<typeof qualificationData>) => {
    console.log("Updating qualification data:", data);
    
    Object.entries(data).forEach(([field, value]) => {
      if (value && value !== "" && value !== 0) {
        setExtractionLog(prev => [...prev, { field, value, timestamp: new Date() }]);
      }
    });
    
    setQualificationData(prev => ({ ...prev, ...data }));
    
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

  const handleModelTurn = (message: LiveServerMessage) => {
    console.log("Received Gemini message:", message);

    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
      console.log("Handling interruption, stopping all audio sources");
      stopAllAudio();
      const userEntry = handleInterruption();
      if (userEntry) {
        console.log("Processing interrupted user entry for extraction");
        extractQualificationData(userEntry, updateQualificationData);
      }
    }

    // Handle input transcription with improved timing
    if (message.serverContent?.inputTranscription) {
      const transcriptText = message.serverContent.inputTranscription.text || "";
      const isPartial = message.serverContent.inputTranscription.isPartial || false;
      
      console.log("Input transcription received:", transcriptText, "isPartial:", isPartial);
      
      // Process transcription immediately, don't wait for turn complete
      const userEntry = handleUserTranscript(transcriptText, isPartial);
      if (userEntry) {
        console.log("Processing finalized user transcript for extraction");
        extractQualificationData(userEntry, updateQualificationData);
      }
    }

    if (message.toolCall) {
      message.toolCall.functionCalls?.forEach(functionCall => {
        console.log(`Execute function ${functionCall.name} with arguments:`, functionCall.args);
        
        if (functionCall.name === 'send_qualification_webhook') {
          const args = functionCall.args as any;
          if (args.qualification_data) {
            updateQualificationData(args.qualification_data);
            handleWebhook(args.qualification_data);
          }
        }
      });

      sendToolResponse(message.toolCall.functionCalls || []);
    }

    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      if (part?.inlineData && part.inlineData.mimeType?.includes('audio')) {
        handleAudioMessage(part.inlineData);
      }

      if (part?.text) {
        handleAiTranscript(part.text);
      }
    }

    if (message.serverContent?.turnComplete) {
      console.log("Turn complete detected");
      const entries = handleTurnComplete();
      entries.forEach(entry => {
        if (entry.speaker === "Usuário") {
          console.log("Processing user entry from turn complete for extraction");
          extractQualificationData(entry, updateQualificationData);
        }
      });
    }

    if (message.serverContent?.generationComplete) {
      handleGenerationComplete();
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
      
      await initializeAudioContext();
      resetConversation();
      
      const session = await createSession({
        apiKey,
        onMessage: handleModelTurn,
        onOpen: () => {
          console.log('Gemini Live session opened');
          addToTranscript("System", "Connected to Gemini Live API");
        },
        onError: (e: ErrorEvent) => {
          console.error('Gemini Live error:', e.message);
          addToTranscript("System", `Error: ${e.message}`);
        },
        onClose: (e: CloseEvent) => {
          console.log('Gemini Live session closed:', e.reason);
          addToTranscript("System", "Session ended");
        }
      });

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
    clearTranscripts();
    stopAudioProcessing();
    stopAllAudio();
    resetAudio();
    resetConversation();
    closeSession();

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

  const handleWebhook = async (data?: any) => {
    try {
      const payload = data || qualificationData;
      await triggerWebhook(payload);

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
          <CallSetup
            apiKey={apiKey}
            isConnecting={isConnecting}
            onApiKeyChange={setApiKey}
            onStartCall={startCall}
          />
        )}

        {isCallActive && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <CallControls
                isCallActive={isCallActive}
                isMuted={isMuted}
                audioLevel={audioLevel}
                onToggleMute={toggleMute}
                onEndCall={endCall}
              />

              <div className="mt-6">
                <QualificationStatus 
                  data={qualificationData} 
                  extractionLog={extractionLog}
                />
              </div>
            </div>

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

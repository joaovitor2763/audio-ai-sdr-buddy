import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import CallSetup from "@/components/CallSetup";
import CallControls from "@/components/CallControls";
import CallTranscript from "@/components/CallTranscript";
import QualificationStatus from "@/components/QualificationStatus";
import QualificationCaptureLog from "@/components/QualificationCaptureLog";
import { LiveServerMessage } from '@google/genai';
import { useAudioProcessor } from "@/hooks/useAudioProcessor";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useTranscriptManager } from "@/hooks/useTranscriptManager";
import { useGeminiSession } from "@/hooks/useGeminiSession";
import { useGeminiQualificationProcessor } from "@/hooks/useGeminiQualificationProcessor";
import { triggerWebhook } from "@/utils/webhookUtils";

interface QualificationLogEntry {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  source: 'user' | 'ai' | 'system';
  confidence: 'high' | 'medium' | 'low';
}

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
  const [qualificationLog, setQualificationLog] = useState<QualificationLogEntry[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  
  const { toast } = useToast();
  const { startAudioProcessing, stopAudioProcessing, toggleMute: toggleAudioMute } = useAudioProcessor();
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
  const { processQualificationData, resetProcessor } = useGeminiQualificationProcessor(apiKey);

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
    
    setQualificationData(prev => {
      const updated = { ...prev, ...data };
      return updated;
    });
  };

  const addQualificationLogEntry = (logEntry: QualificationLogEntry) => {
    setQualificationLog(prev => [...prev, logEntry]);
    
    // Show toast for important captures
    if (logEntry.confidence === 'high' && logEntry.source !== 'system') {
      toast({
        title: "Dados Capturados",
        description: `${logEntry.field.replace('_', ' ')}: ${logEntry.newValue}`,
      });
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
        console.log("Processing interrupted user entry for qualification");
        processQualificationData(userEntry, qualificationData, updateQualificationData, addQualificationLogEntry);
      }
    }

    // Handle input transcription (what the user said)
    if (message.serverContent?.inputTranscription) {
      const transcription = message.serverContent.inputTranscription;
      const transcriptText = transcription.text || "";
      
      console.log("Input transcription received from Live API:", {
        text: transcriptText,
        length: transcriptText.length,
        fullTranscription: transcription
      });
      
      if (transcriptText.trim()) {
        const userEntry = handleUserTranscript(transcriptText, true);
        if (userEntry) {
          console.log("Processing finalized user transcript for qualification:", userEntry);
          processQualificationData(userEntry, qualificationData, updateQualificationData, addQualificationLogEntry);
        }
      }
    }

    // Handle output transcription (what Mari said)
    if (message.serverContent?.outputTranscription) {
      const transcription = message.serverContent.outputTranscription;
      const transcriptText = transcription.text || "";
      
      console.log("Output transcription received:", transcriptText);
      
      if (transcriptText.trim()) {
        handleAiTranscript(transcriptText);
      }
    }

    // Handle tool calls
    if (message.toolCall) {
      message.toolCall.functionCalls?.forEach(functionCall => {
        console.log(`Execute function ${functionCall.name} with arguments:`, functionCall.args);
        
        if (functionCall.name === 'send_qualification_webhook') {
          const args = functionCall.args as any;
          if (args.qualification_data) {
            updateQualificationData(args.qualification_data);
            
            // Log the webhook data
            Object.entries(args.qualification_data).forEach(([field, value]) => {
              if (value && value !== "" && value !== 0) {
                addQualificationLogEntry({
                  timestamp: new Date(),
                  field,
                  oldValue: qualificationData[field as keyof typeof qualificationData],
                  newValue: value,
                  source: 'ai',
                  confidence: 'high'
                });
              }
            });
            
            handleWebhook(args.qualification_data);
          }
        }
      });

      sendToolResponse(message.toolCall.functionCalls || []);
    }

    // Handle model audio and text responses
    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      if (part?.inlineData && part.inlineData.mimeType?.includes('audio')) {
        handleAudioMessage(part.inlineData);
      }

      if (part?.text) {
        handleAiTranscript(part.text);
      }
    }

    // Handle turn completion
    if (message.serverContent?.turnComplete) {
      console.log("Turn complete detected - finalizing transcriptions");
      const entries = handleTurnComplete();
      entries.forEach(entry => {
        console.log("Processing entry from turn complete for qualification");
        processQualificationData(entry, qualificationData, updateQualificationData, addQualificationLogEntry);
      });
    }

    // Handle generation completion
    if (message.serverContent?.generationComplete) {
      console.log("Generation complete detected");
      const aiEntry = handleGenerationComplete();
      if (aiEntry) {
        console.log("Processing AI entry from generation complete for qualification");
        processQualificationData(aiEntry, qualificationData, updateQualificationData, addQualificationLogEntry);
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
      
      await initializeAudioContext();
      resetProcessor();
      
      const session = await createSession({
        apiKey,
        onMessage: handleModelTurn,
        onOpen: () => {
          console.log('Gemini Live session opened');
          addToTranscript("System", "Connected to Gemini Live API");
          addQualificationLogEntry({
            timestamp: new Date(),
            field: 'system',
            oldValue: null,
            newValue: 'Session started',
            source: 'system',
            confidence: 'high'
          });
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
    resetProcessor();
    closeSession();

    setIsCallActive(false);
    setIsMuted(false);
    setAudioLevel(0);
    
    addQualificationLogEntry({
      timestamp: new Date(),
      field: 'system',
      oldValue: null,
      newValue: 'Session ended',
      source: 'system',
      confidence: 'high'
    });
    
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
      
      addQualificationLogEntry({
        timestamp: new Date(),
        field: 'system',
        oldValue: null,
        newValue: 'Data sent to CRM',
        source: 'system',
        confidence: 'high'
      });
      
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
            <div className="lg:col-span-1 space-y-6">
              <CallControls
                isCallActive={isCallActive}
                isMuted={isMuted}
                audioLevel={audioLevel}
                onToggleMute={toggleMute}
                onEndCall={endCall}
              />

              <QualificationStatus 
                data={qualificationData} 
                extractionLog={qualificationLog}
              />

              <QualificationCaptureLog logEntries={qualificationLog} />
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

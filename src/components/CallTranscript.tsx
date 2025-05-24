
import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Bot } from "lucide-react";

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
}

interface CallTranscriptProps {
  transcript: TranscriptEntry[];
  onUserInput?: (input: string) => void;
}

const CallTranscript = ({ transcript, onUserInput }: CallTranscriptProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  return (
    <Card className="h-[600px]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Call Transcript
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[520px] p-4" ref={scrollRef}>
          <div className="space-y-4">
            {transcript.map((entry, index) => (
              <div key={index} className="flex gap-3">
                <div className="flex-shrink-0">
                  {entry.speaker === "Mari" ? (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-blue-600" />
                    </div>
                  ) : entry.speaker === "System" ? (
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                      <User className="h-4 w-4 text-green-600" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge 
                      variant={entry.speaker === "Mari" ? "default" : entry.speaker === "System" ? "secondary" : "outline"}
                      className="text-xs"
                    >
                      {entry.speaker}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 leading-relaxed">
                    {entry.text}
                  </p>
                </div>
              </div>
            ))}
            
            {transcript.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Call transcript will appear here...</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default CallTranscript;

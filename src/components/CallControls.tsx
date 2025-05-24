
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Phone, PhoneOff, Activity } from "lucide-react";
import AudioVisualizer from "@/components/AudioVisualizer";

interface CallControlsProps {
  isCallActive: boolean;
  isMuted: boolean;
  audioLevel: number;
  onToggleMute: () => void;
  onEndCall: () => void;
}

const CallControls = ({ 
  isCallActive, 
  isMuted, 
  audioLevel, 
  onToggleMute, 
  onEndCall 
}: CallControlsProps) => {
  if (!isCallActive) return null;

  return (
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
            onClick={onToggleMute}
            variant={isMuted ? "destructive" : "secondary"}
            size="lg"
            className="flex-1"
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button onClick={onEndCall} variant="destructive" size="lg" className="flex-1">
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
  );
};

export default CallControls;

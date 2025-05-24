
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, Activity } from "lucide-react";

interface CallSetupProps {
  apiKey: string;
  isConnecting: boolean;
  onApiKeyChange: (value: string) => void;
  onStartCall: () => void;
}

const CallSetup = ({ apiKey, isConnecting, onApiKeyChange, onStartCall }: CallSetupProps) => {
  return (
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
            onChange={(e) => onApiKeyChange(e.target.value)}
          />
        </div>
        <Button 
          onClick={onStartCall} 
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
  );
};

export default CallSetup;

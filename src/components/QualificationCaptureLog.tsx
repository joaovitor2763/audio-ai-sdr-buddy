
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, User, Bot, Settings, TrendingUp } from "lucide-react";

interface QualificationLogEntry {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  source: 'user' | 'ai' | 'system';
  confidence: 'high' | 'medium' | 'low';
}

interface QualificationCaptureLogProps {
  logEntries: QualificationLogEntry[];
}

const QualificationCaptureLog = ({ logEntries }: QualificationCaptureLogProps) => {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'user':
        return <User className="h-3 w-3" />;
      case 'ai':
        return <Bot className="h-3 w-3" />;
      default:
        return <Settings className="h-3 w-3" />;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'user':
        return 'bg-green-100 text-green-700';
      case 'ai':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return 'bg-green-100 text-green-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatFieldName = (field: string) => {
    const fieldNames: Record<string, string> = {
      'nome_completo': 'Nome Completo',
      'nome_empresa': 'Nome da Empresa',
      'como_conheceu_g4': 'Como Conheceu G4',
      'faturamento_anual_aproximado': 'Faturamento',
      'total_funcionarios_empresa': 'Funcionários',
      'setor_empresa': 'Setor',
      'principal_desafio': 'Principal Desafio',
      'melhor_dia_contato_especialista': 'Dia Preferido',
      'melhor_horario_contato_especialista': 'Horário Preferido',
      'preferencia_contato_especialista': 'Canal Preferido',
      'telefone': 'Telefone',
      'system': 'Sistema'
    };
    return fieldNames[field] || field;
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '(vazio)';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Qualification Capture Log
          {logEntries.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {logEntries.length} entradas
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-64 p-4">
          {logEntries.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhuma captura registrada ainda</p>
            </div>
          ) : (
            <div className="space-y-3">
              {logEntries.slice().reverse().slice(0, 20).map((entry, index) => (
                <div key={index} className="border-l-2 border-blue-200 pl-3 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      {formatTime(entry.timestamp)}
                    </Badge>
                    <Badge className={`text-xs ${getSourceColor(entry.source)}`}>
                      {getSourceIcon(entry.source)}
                      <span className="ml-1 capitalize">{entry.source}</span>
                    </Badge>
                    <Badge className={`text-xs ${getConfidenceColor(entry.confidence)}`}>
                      {entry.confidence}
                    </Badge>
                  </div>
                  
                  <div className="text-sm">
                    <span className="font-medium text-blue-700">
                      {formatFieldName(entry.field)}:
                    </span>
                    <div className="mt-1 text-xs">
                      {entry.oldValue !== null && entry.oldValue !== undefined && (
                        <div className="text-gray-500">
                          <span className="font-medium">Anterior:</span> {formatValue(entry.oldValue)}
                        </div>
                      )}
                      <div className="text-gray-900">
                        <span className="font-medium">Novo:</span> {formatValue(entry.newValue)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default QualificationCaptureLog;

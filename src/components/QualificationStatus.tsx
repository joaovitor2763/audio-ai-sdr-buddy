
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Circle, Target } from "lucide-react";

interface QualificationData {
  nome_completo: string;
  nome_empresa: string;
  como_conheceu_g4: string;
  faturamento_anual_aproximado: string;
  total_funcionarios_empresa: number;
  setor_empresa: string;
  principal_desafio: string;
  melhor_dia_contato_especialista: string;
  melhor_horario_contato_especialista: string;
  preferencia_contato_especialista: string;
  telefone: string;
  qualificador_nome: string;
}

interface QualificationStatusProps {
  data: QualificationData;
}

const QualificationStatus = ({ data }: QualificationStatusProps) => {
  const fields = [
    { key: 'nome_completo', label: 'Nome Completo', required: true },
    { key: 'nome_empresa', label: 'Nome da Empresa', required: true },
    { key: 'como_conheceu_g4', label: 'Como Conheceu G4', required: true },
    { key: 'faturamento_anual_aproximado', label: 'Faturamento', required: true },
    { key: 'total_funcionarios_empresa', label: 'Funcionários', required: true },
    { key: 'setor_empresa', label: 'Setor', required: true },
    { key: 'principal_desafio', label: 'Principal Desafio', required: true },
    { key: 'melhor_dia_contato_especialista', label: 'Dia Preferido', required: true },
    { key: 'melhor_horario_contato_especialista', label: 'Horário Preferido', required: true },
    { key: 'preferencia_contato_especialista', label: 'Canal Preferido', required: true },
    { key: 'telefone', label: 'Telefone', required: true },
  ];

  const completedFields = fields.filter(field => {
    const value = data[field.key as keyof QualificationData];
    return value && value !== "" && value !== 0;
  });

  const completionPercentage = (completedFields.length / fields.length) * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Qualification Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span>Progress</span>
            <span>{completedFields.length}/{fields.length}</span>
          </div>
          <Progress value={completionPercentage} className="h-2" />
        </div>

        <div className="space-y-2">
          {fields.map((field) => {
            const value = data[field.key as keyof QualificationData];
            const isCompleted = value && value !== "" && value !== 0;
            
            return (
              <div key={field.key} className="flex items-center gap-2 text-sm">
                {isCompleted ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <Circle className="h-4 w-4 text-gray-300" />
                )}
                <span className={isCompleted ? "text-green-700" : "text-gray-500"}>
                  {field.label}
                </span>
                {isCompleted && (
                  <Badge variant="secondary" className="ml-auto text-xs">
                    ✓
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {completionPercentage === 100 && (
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <CheckCircle className="h-6 w-6 text-green-600 mx-auto mb-2" />
            <p className="text-sm text-green-700 font-medium">
              Qualification Complete!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default QualificationStatus;

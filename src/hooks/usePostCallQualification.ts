
import { useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';

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

interface TranscribedSegment {
  speaker: 'user' | 'ai';
  text: string;
  startTime: number;
  endTime: number;
  timestamp: Date;
}

interface QualificationLogEntry {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  source: 'user' | 'ai' | 'system';
  confidence: 'high' | 'medium' | 'low';
}

export const usePostCallQualification = (apiKey: string) => {
  const processFullCallQualification = useCallback(async (
    transcribedSegments: TranscribedSegment[],
    onDataUpdate: (data: Partial<QualificationData>) => void,
    onLogEntry: (logEntry: QualificationLogEntry) => void
  ): Promise<void> => {
    if (!apiKey) {
      throw new Error('API key required for qualification processing');
    }

    if (transcribedSegments.length === 0) {
      console.warn('No transcribed segments to process');
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });

      // Build the full conversation from clean transcription
      const fullConversation = transcribedSegments
        .sort((a, b) => a.startTime - b.startTime)
        .map(segment => {
          const speaker = segment.speaker === 'user' ? 'USUÁRIO' : 'MARI';
          return `[${Math.floor(segment.startTime)}s] ${speaker}: ${segment.text}`;
        })
        .join('\n');

      console.log('🔍 Processing post-call qualification with clean transcription');
      console.log('Full conversation:', fullConversation);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        config: {
          responseMimeType: 'application/json',
          systemInstruction: [
            {
              text: `Você é um especialista em extração de dados de qualificação de leads brasileiros.

CONTEXTO: Esta é uma transcrição COMPLETA e LIMPA de uma call de qualificação comercial da G4 Educação.

TAREFA: Extraia TODAS as informações de qualificação mencionadas na conversa completa.

VANTAGENS DESTA TRANSCRIÇÃO:
- Transcrição completa e precisa da call inteira
- Speaker labels corretos (USUÁRIO vs MARI)
- Timestamps para referência de contexto
- Texto limpo sem erros de transcrição em tempo real

REGRAS DE EXTRAÇÃO:
1. Analise a conversa COMPLETA do início ao fim
2. Extraia informações tanto das falas do USUÁRIO quanto das confirmações da MARI
3. Se a MARI repetiu/confirmou algo que o usuário disse, use a versão mais clara
4. Procure por informações em qualquer parte da conversa (início, meio, fim)
5. Use "Informação não abordada na call" apenas se realmente não foi mencionado
6. Priorize clareza e completude - esta é nossa única chance de extrair os dados

DADOS PARA EXTRAIR:
- nome_completo: Nome completo da pessoa
- nome_empresa: Nome da empresa onde trabalha
- como_conheceu_g4: Como conheceu o G4 (Instagram, indicação, etc.)
- faturamento_anual_aproximado: Faturamento da empresa
- total_funcionarios_empresa: Número de funcionários (apenas número)
- setor_empresa: Setor de atuação da empresa
- principal_desafio: Principal desafio mencionado
- melhor_dia_contato_especialista: Dia preferido para contato
- melhor_horario_contato_especialista: Horário preferido
- preferencia_contato_especialista: Canal preferido (WhatsApp, telefone)
- telefone: Telefone para contato
- analysis_confidence: "alta", "média" ou "baixa"
- extraction_notes: Observações importantes sobre a extração

FORMATO DE RESPOSTA (JSON):
{
  "nome_completo": "valor extraído ou 'Informação não abordada na call'",
  "nome_empresa": "valor extraído ou 'Informação não abordada na call'",
  "como_conheceu_g4": "valor extraído ou 'Informação não abordada na call'",
  "faturamento_anual_aproximado": "valor extraído ou 'Informação não abordada na call'",
  "total_funcionarios_empresa": "número ou 'Informação não abordada na call'",
  "setor_empresa": "valor extraído ou 'Informação não abordada na call'",
  "principal_desafio": "valor extraído ou 'Informação não abordada na call'",
  "melhor_dia_contato_especialista": "valor extraído ou 'Informação não abordada na call'",
  "melhor_horario_contato_especialista": "valor extraído ou 'Informação não abordada na call'",
  "preferencia_contato_especialista": "valor extraído ou 'Informação não abordada na call'",
  "telefone": "valor extraído ou 'Informação não abordada na call'",
  "analysis_confidence": "alta/média/baixa",
  "extraction_notes": "observações importantes"
}

Extraia os dados da transcrição completa:`
            }
          ]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `TRANSCRIÇÃO COMPLETA DA CALL DE QUALIFICAÇÃO:

${fullConversation}

Extraia TODAS as informações de qualificação mencionadas nesta conversa completa e limpa.`
              }
            ]
          }
        ]
      });

      const responseText = response.text || '';
      console.log('📊 Post-call qualification response:', responseText);

      const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const extractedData = JSON.parse(cleanedResponse);

      // Process the extracted data
      const updates: Partial<QualificationData> = {};
      let hasUpdates = false;

      Object.entries(extractedData).forEach(([key, value]) => {
        if (key === 'analysis_confidence' || key === 'extraction_notes') {
          return;
        }

        if (value && 
            value !== '' && 
            value !== 'Informação não abordada na call' && 
            value !== 'null' &&
            value !== 'undefined') {
          
          // Convert total_funcionarios_empresa to number
          let processedValue = value;
          if (key === 'total_funcionarios_empresa' && typeof value === 'string') {
            const numMatch = (value as string).match(/\d+/);
            if (numMatch) {
              const numValue = parseInt(numMatch[0]);
              if (!isNaN(numValue)) {
                processedValue = numValue;
              }
            }
          }
          
          (updates as any)[key] = processedValue;
          hasUpdates = true;
          
          console.log(`✅ Post-call extraction - ${key}: ${processedValue}`);
          
          onLogEntry({
            timestamp: new Date(),
            field: key,
            oldValue: null,
            newValue: processedValue,
            source: 'ai',
            confidence: extractedData.analysis_confidence === 'alta' ? 'high' : 
                      extractedData.analysis_confidence === 'média' ? 'medium' : 'low'
          });
        }
      });

      if (hasUpdates) {
        console.log('📥 Applying post-call qualification updates:', updates);
        onDataUpdate(updates);
        
        if (extractedData.extraction_notes && extractedData.extraction_notes !== 'Informação não abordada na call') {
          onLogEntry({
            timestamp: new Date(),
            field: 'system',
            oldValue: null,
            newValue: `Post-call Notes: ${extractedData.extraction_notes}`,
            source: 'ai',
            confidence: 'high'
          });
        }
      } else {
        console.log('⚠️ No meaningful qualification data extracted from post-call transcription');
      }

    } catch (error) {
      console.error('❌ Error processing post-call qualification:', error);
      throw error;
    }
  }, [apiKey]);

  return {
    processFullCallQualification
  };
};

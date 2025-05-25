import { useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: Date;
  turnId: string;
}

interface QualificationLogEntry {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  source: 'user' | 'ai' | 'system';
  confidence: 'high' | 'medium' | 'low';
}

export const useGeminiQualificationProcessor = (apiKey?: string) => {
  const geminiRef = useRef<GoogleGenAI | null>(null);
  const conversationHistoryRef = useRef<TranscriptEntry[]>([]);

  // Initialize Gemini when API key is available
  const initializeGemini = useCallback(() => {
    if (apiKey && !geminiRef.current) {
      geminiRef.current = new GoogleGenAI({ apiKey });
      console.log("✅ Gemini qualification processor initialized");
    }
  }, [apiKey]);

  const processQualificationData = useCallback(async (
    newEntry: TranscriptEntry,
    currentData: any,
    updateData: (data: any) => void,
    addLogEntry: (entry: QualificationLogEntry) => void
  ) => {
    initializeGemini();
    
    if (!geminiRef.current) {
      console.log("❌ Gemini not initialized for qualification processing");
      return;
    }

    // Add to conversation history
    conversationHistoryRef.current.push(newEntry);
    
    // Keep only recent conversation (last 20 entries)
    if (conversationHistoryRef.current.length > 20) {
      conversationHistoryRef.current = conversationHistoryRef.current.slice(-20);
    }

    try {
      // Build conversation context
      const conversationContext = conversationHistoryRef.current
        .map(entry => `${entry.speaker}: ${entry.text}`)
        .join('\n');

      console.log("🔍 Processing qualification with context:", {
        newEntry: `${newEntry.speaker}: ${newEntry.text}`,
        turnId: newEntry.turnId,
        historyLength: conversationHistoryRef.current.length
      });

      const model = geminiRef.current.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `Você é um especialista em extração de dados de qualificação de leads para a G4 Educação.

CONTEXTO DA CONVERSA COMPLETA:
${conversationContext}

DADOS ATUAIS:
${JSON.stringify(currentData, null, 2)}

TAREFA:
Analise TODA a conversa acima e extraia/atualize as informações de qualificação. Use tanto as falas da Mari quanto do usuário para inferir as respostas corretas.

REGRAS IMPORTANTES:
1. Use TODA a conversa para inferir informações, não apenas a última mensagem
2. Mari frequentemente confirma ou repete informações - use isso para validar dados
3. Se houver conflito, prefira a informação mais recente ou confirmada por Mari
4. Mantenha dados existentes se não houver novas informações
5. Seja inferencial - por exemplo, "acompanho os conteúdos no Instagram" = "Instagram"

CAMPOS OBRIGATÓRIOS:
- nome_completo: Nome completo da pessoa
- nome_empresa: Nome da empresa
- como_conheceu_g4: Como conheceu (Instagram, indicação, Google, etc.)
- faturamento_anual_aproximado: Faturamento da empresa (formato: R$ X.XXX.XXX)
- total_funcionarios_empresa: Número de funcionários (número inteiro)
- setor_empresa: Setor de atuação
- principal_desafio: Principal desafio da empresa
- melhor_dia_contato_especialista: Melhor dia para contato
- melhor_horario_contato_especialista: Melhor horário
- preferencia_contato_especialista: "Ligacao" ou "WhatsApp"
- telefone: Número de telefone
- qualificador_nome: "Mari"

Retorne APENAS um JSON com os campos que foram identificados/atualizados na conversa. NÃO inclua campos vazios ou null.

Exemplo de resposta:
{
  "nome_completo": "João Vítor Silva",
  "como_conheceu_g4": "Instagram",
  "total_funcionarios_empresa": 80,
  "principal_desafio": "turnover da equipe"
}`
          }]
        }]
      });

      const response = await model;
      const responseText = response.text?.trim();
      
      console.log("🤖 Gemini qualification response:", responseText);

      if (responseText) {
        try {
          const extractedData = JSON.parse(responseText);
          
          if (extractedData && typeof extractedData === 'object') {
            // Process each extracted field
            Object.entries(extractedData).forEach(([field, value]) => {
              if (value !== null && value !== undefined && value !== '') {
                const oldValue = currentData[field];
                
                // Only update if value is different
                if (oldValue !== value) {
                  console.log(`📊 Updating field: ${field} = ${value}`);
                  
                  addLogEntry({
                    timestamp: new Date(),
                    field,
                    oldValue,
                    newValue: value,
                    source: newEntry.speaker === 'Mari' ? 'ai' : 'user',
                    confidence: 'high'
                  });
                }
              }
            });
            
            // Update the qualification data
            updateData(extractedData);
          }
        } catch (parseError) {
          console.error("❌ Error parsing qualification response:", parseError);
        }
      }
    } catch (error) {
      console.error("❌ Error processing qualification data:", error);
    }
  }, [initializeGemini]);

  const resetProcessor = useCallback(() => {
    conversationHistoryRef.current = [];
    console.log("🔄 Qualification processor reset");
  }, []);

  return {
    processQualificationData,
    resetProcessor
  };
};

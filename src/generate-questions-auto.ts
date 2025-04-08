import 'dotenv/config'; 
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY não configuradas.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const apiKeys = {
  easy: process.env.DEEPSEEK_API_KEY_EASY,
  medium: process.env.DEEPSEEK_API_KEY_MEDIUM,
  hard: process.env.DEEPSEEK_API_KEY_HARD,
  feedback: process.env.DEEPSEEK_API_KEY_FEEDBACK,
  hints: process.env.DEEPSEEK_API_KEY_HINTS
};

const API_URL = 'https://api.deepseek.com/v1/chat/completions';

const TOPICS = [
  'Adição de monômios semelhantes',
  'Subtração de monômios semelhantes',
  'Multiplicação de monômios',
  'Divisão de monômios',
  'Potenciação de monômios',
  'Adição e subtração de binômios',
  'Multiplicação de binômio por monômio',
  'Multiplicação de binômios',
  'Produto notável: quadrado da soma',
  'Produto notável: quadrado da diferença',
  'Produto notável: produto da soma pela diferença',
  'Operações com trinômios',
  'Fatoração de trinômios',
  'Valor numérico de polinômios',
  'Simplificação de expressões algébricas'
];

const QUOTA_LIMITS: Record<string, number> = {
  easy: 300,
  medium: 200,
  hard: 100
};

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

const QUESTIONS_PER_TOPIC_LEVEL = 2;

interface QuestionData {
  question: string;
  options: string[];
  correctOption: number;
  explanation: string;
  topic: string;
  difficulty: string;
  createdAt: string;
  hints?: string[];
}

// Define interface for DeepSeek API response
interface DeepSeekMessage {
  role: string;
  content: string;
}

interface DeepSeekChoice {
  message: DeepSeekMessage;
  index: number;
  finish_reason: string;
}

interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function checkCurrentQuestionCounts(): Promise<Record<string, number>> {
  console.log('Verificando contagem de questões por nível...');
  const counts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };

  for (const difficulty of DIFFICULTY_LEVELS) {
    const { count, error } = await supabase
      .from('questions')
      .select('id', { count: 'exact' })
      .eq('difficulty', difficulty);

    if (error) {
      console.error(`Erro ao obter contagem (${difficulty}):`, error.message);
      continue;
    }
    counts[difficulty] = count || 0;
    console.log(`Nível "${difficulty}": ${counts[difficulty]}/${QUOTA_LIMITS[difficulty]} questões`);
  }

  return counts;
}


async function generateQuestion(topic: string, difficulty: string): Promise<QuestionData> {
  console.log(`Gerando questão sobre "${topic}" (nível: ${difficulty})`);

  const apiKey = apiKeys[difficulty as keyof typeof apiKeys];
  if (!apiKey) {
    throw new Error(`API key não encontrada para o nível ${difficulty}`);
  }

  const prompt = `
  Gere uma questão de álgebra sobre "${topic}" com nível de dificuldade "${difficulty}".
  
  Requisitos:
  - Para nível "easy": operações diretas com números inteiros positivos pequenos e uma variável
  - Para nível "medium": operações com números inteiros (positivos/negativos) e até duas variáveis
  - Para nível "hard": operações mais complexas, podendo envolver frações ou expoentes maiores
  
  Regras:
  - Use notação simples como x², x³
  - Crie questões focadas em um único conceito/operação por vez para níveis fáceis
  - Garanta que as respostas incorretas sejam plausíveis mas claramente erradas
  
  Formato JSON (sem texto adicional):
  {
    "question": "Enunciado da questão",
    "options": ["Alternativa A", "Alternativa B", ...],
    "correctOption": 0,
    "explanation": "Solução passo a passo"
  }
  `;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erro na API DeepSeek: ${response.status} - ${text}`);
  }

  const data = await response.json() as DeepSeekResponse;
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) {
    throw new Error('Resposta vazia ou inválida da API DeepSeek');
  }

  let questionJson: any;
  try {
    questionJson = JSON.parse(content.trim());
  } catch {
    const match = content.match(/({[\s\S]*})/);
    if (match) {
      questionJson = JSON.parse(match[0]);
    } else {
      throw new Error('Não foi possível extrair JSON da resposta.');
    }
  }

  const questionData: QuestionData = {
    question: questionJson.question,
    options: questionJson.options,
    correctOption: questionJson.correctOption,
    explanation: questionJson.explanation,
    topic,
    difficulty,
    createdAt: new Date().toISOString()
  };

  return questionData;
}


async function generateHints(question: QuestionData): Promise<string[]> {
  const hintsApiKey = apiKeys.hints;
  if (!hintsApiKey) {
    console.log('API key para dicas não encontrada. Pulando geração de hints.');
    return [];
  }

  const prompt = `
    Dada a seguinte questão de álgebra:
    "${question.question}"

    Crie três dicas progressivas:
    1. Uma dica sutil (não entrega a resposta)
    2. Uma dica moderada
    3. Uma dica quase explícita
    
    Responda somente com um array JSON: ["dica1", "dica2", "dica3"]
  `;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hintsApiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    console.error('Erro ao gerar dicas:', response.statusText);
    return [];
  }

  const data = await response.json() as DeepSeekResponse;
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) {
    return [];
  }

  try {
    return JSON.parse(content.trim());
  } catch {
    const match = content.match(/\[(.*?)\]/s);
    if (match) {
      try {
        return JSON.parse(`[${match[1]}]`);
      } catch {
        return [];
      }
    }
    return [];
  }
}


async function saveQuestionToSupabase(question: QuestionData) {
  const { data, error } = await supabase
    .from('questions')
    .insert([question]);

  if (error) {
    throw new Error(`Erro ao salvar questão no Supabase: ${error.message}`);
  }

  console.log(`Questão salva com sucesso: ${question.question.slice(0, 40)}...`);
  return data;
}

async function main() {
  console.log('Iniciando geração de questões...');

  const questionCounts = await checkCurrentQuestionCounts();
  const generatedQuestions: QuestionData[] = [];

  for (const topic of TOPICS) {
    for (const difficulty of DIFFICULTY_LEVELS) {
      if (!apiKeys[difficulty as keyof typeof apiKeys]) {
        console.log(`Pulando ${topic} (${difficulty}) - API key não configurada.`);
        continue;
      }

      if (questionCounts[difficulty] >= QUOTA_LIMITS[difficulty]) {
        console.log(`Pulando ${topic} (${difficulty}) - Cota atingida (${questionCounts[difficulty]}/${QUOTA_LIMITS[difficulty]})`);
        continue;
      }

      const remainingQuota = QUOTA_LIMITS[difficulty] - questionCounts[difficulty];
      const questionsToGenerate = Math.min(QUESTIONS_PER_TOPIC_LEVEL, remainingQuota);
      if (questionsToGenerate <= 0) continue;

      console.log(`Gerando ${questionsToGenerate} questões para ${topic} (nível ${difficulty})...`);

      for (let i = 0; i < questionsToGenerate; i++) {
        try {
          const question = await generateQuestion(topic, difficulty);

          const hints = await generateHints(question);
          if (hints.length > 0) {
            question.hints = hints;
          }

          await saveQuestionToSupabase(question);
          generatedQuestions.push(question);

          questionCounts[difficulty]++;

          await new Promise((resolve) => setTimeout(resolve, 1000));

        } catch (err: any) {
          console.error(`Erro ao gerar/salvar questão [${topic} - ${difficulty}]:`, err.message);
        }
      }
    }
  }

  const outputDir = 'questions-output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `questions-${timestamp}.json`);

  fs.writeFileSync(outputPath, JSON.stringify(generatedQuestions, null, 2));

  console.log(`\nTotal de questões geradas: ${generatedQuestions.length}`);
  console.log(`Arquivo JSON salvo em: ${outputPath}`);
  console.log('Contagem final de cada nível:', questionCounts);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});

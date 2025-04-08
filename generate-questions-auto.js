// Script para geração automática de questões
// Este script conecta ao Supabase e usa a API DeepSeek para gerar questões

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Carrega variáveis de ambiente do arquivo .env, se existir
try {
  require('dotenv').config();
} catch (error) {
  console.log('Arquivo .env não encontrado, usando variáveis de ambiente do sistema');
}

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// API keys para diferentes níveis de dificuldade
const apiKeys = {
  easy: process.env.DEEPSEEK_API_KEY_EASY,
  medium: process.env.DEEPSEEK_API_KEY_MEDIUM,
  hard: process.env.DEEPSEEK_API_KEY_HARD,
  feedback: process.env.DEEPSEEK_API_KEY_FEEDBACK,
  hints: process.env.DEEPSEEK_API_KEY_HINTS
};

// URL da API DeepSeek
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Tópicos para geração de questões
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

// Limites de cotas por nível de dificuldade
const QUOTA_LIMITS = {
  easy: 300,
  medium: 200,
  hard: 100
};

// Níveis de dificuldade
const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

// Número de questões por tópico e nível
const QUESTIONS_PER_TOPIC_LEVEL = 2;

/**
 * Verifica o número atual de questões por nível
 */
async function checkCurrentQuestionCounts() {
  console.log('Verificando número atual de questões por nível...');
  
  try {
    const counts = {};
    
    for (const difficulty of DIFFICULTY_LEVELS) {
      const { count, error } = await supabase
        .from('questions')
        .select('id', { count: 'exact' })
        .eq('difficulty', difficulty);
      
      if (error) {
        throw error;
      }
      
      counts[difficulty] = count || 0;
      console.log(`${difficulty}: ${counts[difficulty]}/${QUOTA_LIMITS[difficulty]} questões`);
    }
    
    return counts;
  } catch (error) {
    console.error('Erro ao verificar contagem de questões:', error.message);
    return { easy: 0, medium: 0, hard: 0 };
  }
}

/**
 * Gera uma questão usando a API DeepSeek
 */
async function generateQuestion(topic, difficulty) {
  console.log(`Gerando questão sobre ${topic} (${difficulty})...`);
  
  const apiKey = apiKeys[difficulty];
  if (!apiKey) {
    throw new Error(`API key para o nível ${difficulty} não encontrada`);
  }

  // Prompt para a API
  const prompt = `
  Gere uma questão de álgebra sobre "${topic}" com nível de dificuldade "${difficulty}".
  
  Requisitos:
  - Para nível "easy": operações diretas com números inteiros positivos pequenos e uma variável
  - Para nível "medium": operações com números inteiros (positivos e negativos) e até duas variáveis
  - Para nível "hard": operações mais complexas, envolvendo frações ou expoentes maiores
  
  Importantes regras para todas as questões:
  - Use notação simples como x², x³ em vez de notações complexas
  - Aceite simplificações como 3x² + 5x² = 8x²
  - Crie questões que envolvam um único conceito/operação por vez para níveis fáceis
  - Para questões de adição/subtração, use apenas termos semelhantes em níveis fáceis
  - Inclua no enunciado exemplos de como os termos podem ser escritos (quando relevante)
  - Garanta que as respostas incorretas sejam plausíveis mas claramente erradas
  
  Exemplos para cada nível:
  1. Fácil: "Qual é o resultado de 3x² + 5x²?"
  2. Médio: "Simplifique a expressão: 2x² - 3x + 4x - x²"
  3. Difícil: "Fatore completamente: 4x² - 9y²"
  
  Formato da resposta:
  {
    "question": "O enunciado completo da questão",
    "options": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D", "Alternativa E"],
    "correctOption": 0,
    "explanation": "Explicação passo-a-passo"
  }
  
  Responda somente com o JSON, sem texto adicional.
  `;

  try {
    const response = await axios.post(
      API_URL,
      {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    const content = response.data.choices[0].message.content;
    let questionData;
    
    // Tenta fazer o parse do JSON
    try {
      questionData = JSON.parse(content.trim());
    } catch (error) {
      // Se falhar, tenta extrair JSON por regex
      const jsonMatch = content.match(/({[\s\S]*})/);
      if (jsonMatch) {
        questionData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Não foi possível extrair JSON da resposta');
      }
    }

    // Adiciona metadados
    questionData.topic = topic;
    questionData.difficulty = difficulty;
    questionData.createdAt = new Date().toISOString();
    
    return questionData;
  } catch (error) {
    console.error('Erro ao gerar questão:', error.message);
    if (error.response) {
      console.error('Resposta da API:', error.response.data);
    }
    throw error;
  }
}

/**
 * Gera dicas para uma questão
 */
async function generateHints(question) {
  console.log(`Gerando dicas para questão sobre ${question.topic}...`);
  
  const apiKey = apiKeys.hints;
  if (!apiKey) {
    console.log('API key para dicas não encontrada, pulando geração de dicas');
    return [];
  }

  const prompt = `
  Dada a seguinte questão de álgebra:
  "${question.question}"
  
  Crie três dicas progressivas para ajudar um estudante a resolvê-la:
  
  1. Uma dica sutil
  2. Uma dica moderada
  3. Uma dica quase explícita
  
  Retorne apenas um array JSON no formato: ["dica1", "dica2", "dica3"]
  `;

  try {
    const response = await axios.post(
      API_URL,
      {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 500
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    const content = response.data.choices[0].message.content;
    try {
      return JSON.parse(content.trim());
    } catch (error) {
      // Tenta extrair por regex
      const match = content.match(/\[(.*?)\]/s);
      if (match) {
        return JSON.parse(`[${match[1]}]`);
      }
      return [];
    }
  } catch (error) {
    console.error('Erro ao gerar dicas:', error.message);
    return [];
  }
}

/**
 * Salva a questão no Supabase
 */
async function saveQuestionToSupabase(question) {
  try {
    const { data, error } = await supabase
      .from('questions')
      .insert([question]);

    if (error) {
      throw error;
    }
    
    console.log(`Questão salva com sucesso: ${question.question.substring(0, 30)}...`);
    return data;
  } catch (error) {
    console.error('Erro ao salvar questão no Supabase:', error.message);
    throw error;
  }
}

/**
 * Função principal que orquestra todo o processo
 */
async function main() {
  console.log('Iniciando geração de questões...');
  
  // Verifica se as credenciais do Supabase estão configuradas
  if (!supabaseUrl || !supabaseKey) {
    console.error('Erro: Credenciais do Supabase não configuradas.');
    process.exit(1);
  }

  // Verifica se pelo menos uma API key está configurada
  const hasApiKey = Object.values(apiKeys).some(key => !!key);
  if (!hasApiKey) {
    console.error('Erro: Nenhuma API key do DeepSeek configurada.');
    process.exit(1);
  }

  // Verifica quantas questões já temos
  let questionCounts = { easy: 0, medium: 0, hard: 0 };
  try {
    questionCounts = await checkCurrentQuestionCounts();
  } catch (err) {
    console.error('Erro ao obter contagem de questões existentes:', err.message);
  }

  // Guardaremos as questões geradas localmente também
  const generatedQuestions = [];

  // Gera questões em lote, por tópico e dificuldade
  for (const topic of TOPICS) {
    for (const difficulty of DIFFICULTY_LEVELS) {
      if (!apiKeys[difficulty]) {
        console.log(`Pulando ${topic} (${difficulty}) - API key não configurada`);
        continue;
      }
      
      if (questionCounts[difficulty] >= QUOTA_LIMITS[difficulty]) {
        console.log(`Pulando ${topic} (${difficulty}) - Cota atingida (${questionCounts[difficulty]}/${QUOTA_LIMITS[difficulty]})`);
        continue;
      }
      
      const remainingQuota = QUOTA_LIMITS[difficulty] - questionCounts[difficulty];
      const questionsToGenerate = Math.min(QUESTIONS_PER_TOPIC_LEVEL, remainingQuota);
      
      if (questionsToGenerate <= 0) {
        continue;
      }
      
      console.log(`Gerando ${questionsToGenerate} questão(ões) para ${topic} (${difficulty})...`);
      
      for (let i = 0; i < questionsToGenerate; i++) {
        try {
          const question = await generateQuestion(topic, difficulty);
          
          // Gera dicas
          const hints = await generateHints(question);
          if (hints.length > 0) {
            question.hints = hints;
          }
          
          // Salva no Supabase
          await saveQuestionToSupabase(question);
          generatedQuestions.push(question);

          // Incrementa localmente para não gerar além da cota
          questionCounts[difficulty]++;
          
          // Espera 1s para evitar "flood" na API
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          console.error(`Erro ao gerar/salvar questão [${topic} - ${difficulty}]:`, err.message);
        }
      }
    }
  }

  // Salva localmente num .json
  const outputDir = 'questions-output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `questions-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(generatedQuestions, null, 2));
  
  console.log(`\nForam geradas ${generatedQuestions.length} questões ao todo.`);
  console.log(`Arquivo JSON salvo em: ${outputPath}`);
  console.log(`Contagem final: easy=${questionCounts.easy}, medium=${questionCounts.medium}, hard=${questionCounts.hard}`);
}

main().catch(err => {
  console.error('Erro fatal no script:', err);
  process.exit(1);
});

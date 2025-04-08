// Script para geração automática de questões
// Este script conecta ao Supabase e usa a API DeepSeek para gerar questões
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Carrega variáveis de ambiente do arquivo .env caso exista
try {
  require('dotenv').config();
} catch (error) {
  console.log('Arquivo .env não encontrado, usando variáveis de ambiente do sistema');
}

// Configuração Supabase
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

// Tópicos para geração de questões - ATUALIZADOS para focar em monômios, binômios e trinômios
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

// Limites de cotas por nível de dificuldade - ATUALIZADOS
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
 * Verifica o número atual de questões por nível de dificuldade
 * @returns {Promise<Object>} - Objeto com o número de questões por nível
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
    // Em caso de erro, retorna contagens zeradas para permitir geração
    return { easy: 0, medium: 0, hard: 0 };
  }
}

/**
 * Gera uma questão usando a API DeepSeek
 * @param {string} topic - Tópico da questão
 * @param {string} difficulty - Nível de dificuldade
 * @returns {Promise<Object>} - Objeto com a questão gerada
 */
async function generateQuestion(topic, difficulty) {
  console.log(`Gerando questão sobre ${topic} (${difficulty})...`);
  
  const apiKey = apiKeys[difficulty];
  if (!apiKey) {
    throw new Error(`API key para o nível ${difficulty} não encontrada`);
  }

  // PROMPT ATUALIZADO para gerar questões mais robustas e específicas
  const prompt = `
  Gere uma questão de álgebra sobre "${topic}" com nível de dificuldade "${difficulty}".
  
  Requisitos:
  - Para nível "easy": operações diretas com números inteiros positivos pequenos e uma variável
  - Para nível "medium": operações com números inteiros (positivos e negativos) e até duas variáveis
  - Para nível "hard": operações mais complexas, envolvendo frações ou expoentes maiores
  
  Importantes regras para todas as questões:
  - Use notação simples como x², x³ em vez de notações complexas
  - Aceite simplificações como 3x² + 5x² = 8x² ou 3xx + 5xx = 8xx
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
    "correctOption": "índice da alternativa correta (0-4)",
    "explanation": "Explicação detalhada da solução que mostre o passo-a-passo"
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

    // Extrai o JSON da resposta
    const content = response.data.choices[0].message.content;
    let questionData;
    
    try {
      // Tenta fazer o parse do JSON
      questionData = JSON.parse(content.trim());
    } catch (error) {
      // Se falhar, tenta extrair JSON usando regex
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
 * @param {Object} question - Objeto da questão gerada
 * @returns {Promise<Array>} - Array com dicas em diferentes níveis
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
  
  1. Uma dica sutil que apenas orienta na direção certa
  2. Uma dica moderada que explica um conceito-chave necessário
  3. Uma dica direta que praticamente indica o caminho para a solução (sem dar a resposta)
  
  Certifique-se que as dicas sejam claras e adequadas para alunos do ensino fundamental/médio.
  
  Retorne apenas um array JSON no formato:
  ["dica1", "dica2", "dica3"]
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
      // Tenta extrair o array JSON
      const hintsArray = JSON.parse(content.trim());
      return Array.isArray(hintsArray) ? hintsArray : [];
    } catch (error) {
      // Tenta extrair usando regex se o parse falhar
      const match = content.match(/\[(.*?)\]/s);
      if (match) {
        try {
          return JSON.parse(`[${match[1]}]`);
        } catch {
          // Se ainda falhar, retorna vazio
          return [];
        }
      }
      console.error('Erro ao extrair dicas:', error.message);
      return [];
    }
  } catch (error) {
    console.error('Erro ao gerar dicas:', error.message);
    return [];
  }
}

/**
 * Salva a questão no Supabase
 * @param {Object} question - Questão a ser salva
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
 * Função principal que gerencia todo o processo
 */
async function main() {
  console.log('Iniciando geração de questões...');
  
  // Verifica se as credenciais estão configuradas
  if (!supabaseUrl || !supabaseKey) {
    console.error('Erro: Credenciais do Supabase não configuradas');
    process.exit(1);
  }

  // Verifica se pelo menos uma API key está configurada
  const hasApiKey = Object.values(apiKeys).some(key => !!key);
  if (!hasApiKey) {
    console.error('Erro: Nenhuma API key do DeepSeek configurada');
    process.exit(1);
  }

  // Verifica o número atual de questões por nível
  let questionCounts;
  try {
    questionCounts = await checkCurrentQuestionCounts();
  } catch (error) {
    console.error('Erro ao verificar contagem de questões:', error.message);
    // Se falhar, assume valores zerados para continuar
    questionCounts = { easy: 0, medium: 0, hard: 0 };
  }

  // Array para armazenar as questões geradas
  const generatedQuestions = [];

  // Gera questões para cada tópico e nível de dificuldade
  for (const topic of TOPICS) {
    for (const difficulty of DIFFICULTY_LEVELS) {
      // Pula níveis sem API key configurada
      if (!apiKeys[difficulty]) {
        console.log(`Pulando ${topic} (${difficulty}) - API key não configurada`);
        continue;
      }
      
      // Verifica se atingiu a cota para este nível
      if (questionCounts[difficulty] >= QUOTA_LIMITS[difficulty]) {
        console.log(`Pulando ${topic} (${difficulty}) - Cota atingida (${questionCounts[difficulty]}/${QUOTA_LIMITS[difficulty]})`);
        continue;
      }
      
      // Calcula quantas questões ainda podem ser geradas neste nível
      const remainingQuota = QUOTA_LIMITS[difficulty] - questionCounts[difficulty];
      const questionsToGenerate = Math.min(QUESTIONS_PER_TOPIC_LEVEL, remainingQuota);
      
      if (questionsToGenerate <= 0) {
        continue;
      }
      
      console.log(`Gerando ${questionsToGenerate} questões para ${topic} (${difficulty}) - Restam ${remainingQuota} na cota`);
      
      // Gera o número especificado de questões por tópico/nível
      for (let i = 0; i < questionsToGenerate; i++) {
        try {
          // Tenta gerar a questão
          const question = await generateQuestion(topic, difficulty);
          
          // Gera dicas para a questão
          const hints = await generateHints(question);
          if (hints.length > 0) {
            question.hints = hints;
          }
          
          // Salva no Supabase
          await saveQuestionToSupabase(question);
          
          // Incrementa a contagem local
          questionCounts[difficulty]++;
          
          // Adiciona ao array local
          generatedQuestions.push(question);
          
          // Aguarda 1 segundo entre requisições para não sobrecarregar a API
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Falha ao processar questão de ${topic} (${difficulty}):`, error.message);
          // Continua para a próxima questão mesmo em caso de erro
        }
      }
    }
  }

  // Salva um registro local das questões geradas
  const outputDir = 'questions-output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(outputDir, `questions-${timestamp}.json`);
  
  fs.writeFileSync(outputFile, JSON.stringify(generatedQuestions, null, 2));
  console.log(`Questões salvas localmente em ${outputFile}`);
  console.log(`Total de questões geradas: ${generatedQuestions.length}`);
  
  // Exibe o resumo final
  console.log('\nResumo final de quotas:');
  for (const difficulty of DIFFICULTY_LEVELS) {
    console.log(`${difficulty}: ${questionCounts[difficulty]}/${QUOTA_LIMITS[difficulty]} questões`);
  }
}

// Executa a função principal
main().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});

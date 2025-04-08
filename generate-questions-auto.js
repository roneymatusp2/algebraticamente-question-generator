/**
 * Script para geração automática de questões matemáticas
 * Este script é executado pelo GitHub Actions para manter o banco
 * de dados atualizado com novas questões diariamente.
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Configuração do cliente Supabase usando variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Chaves API do DeepSeek para diferentes níveis de dificuldade
const apiKeys = {
  easy: process.env.DEEPSEEK_API_KEY_EASY,
  medium: process.env.DEEPSEEK_API_KEY_MEDIUM,
  hard: process.env.DEEPSEEK_API_KEY_HARD
};

// Configuração dos tópicos e quantidade de questões a gerar por nível
const topics = [
  'polinômios', 
  'funções', 
  'geometria analítica', 
  'trigonometria',
  'matrizes',
  'álgebra linear'
];

const countPerDifficulty = 5; // Gerar 5 questões por dificuldade por tópico

/**
 * Gera questões para um tópico e dificuldade específicos
 */
async function generateQuestions(topic, difficulty, apiKey) {
  console.log(`Gerando ${countPerDifficulty} questões ${difficulty} sobre ${topic}...`);
  
  const functionUrl = 'https://xfsovvhrfgxzlwwjhlns.functions.supabase.co/generate-questions';
  const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhmc292dmhyZmd4emx3d2pobG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQwNzM5MDIsImV4cCI6MjA1OTY0OTkwMn0.YBlOHqBtjDKctLLDyqy8zVqtj15R5kDyTCE9DFy71I8';
  
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        count: countPerDifficulty,
        difficulty: difficulty,
        topic: topic,
        DEEPSEEK_API_KEY: apiKey
      })
    });
    
    const data = await response.json();
    console.log(`Sucesso! Geradas ${data.count || 0} questões ${difficulty} sobre ${topic}`);
    return data;
  } catch (error) {
    console.error(`Erro ao gerar questões ${difficulty} sobre ${topic}:`, error);
    return null;
  }
}

/**
 * Função principal para executar todo o processo de geração
 */
async function main() {
  console.log('Iniciando geração automatizada de questões...');
  
  // Para cada tópico, gerar questões em diferentes níveis de dificuldade
  for (const topic of topics) {
    // Gerar questões fáceis
    await generateQuestions(topic, 'fácil', apiKeys.easy);
    // Pequena pausa para não sobrecarregar a API
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Gerar questões médias
    await generateQuestions(topic, 'médio', apiKeys.medium);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Gerar questões difíceis
    await generateQuestions(topic, 'difícil', apiKeys.hard);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('Processo de geração de questões concluído com sucesso!');
}

// Executa a função principal
main().catch(error => {
  console.error('Erro durante a execução do script:', error);
  process.exit(1);
}); 
/* eslint-disable no-console */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';

// ---------- CREDENCIAIS SUPABASE ----------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY não configuradas.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ---------- CHAVES DE API ----------
const apiKeys = {
  easy:     process.env.DEEPSEEK_API_KEY_EASY,
  medium:   process.env.DEEPSEEK_API_KEY_MEDIUM,
  hard:     process.env.DEEPSEEK_API_KEY_HARD,
  feedback: process.env.DEEPSEEK_API_KEY_FEEDBACK,
  hints:    process.env.DEEPSEEK_API_KEY_HINTS
};

// ---------- CONSTANTES ----------
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
] as const;

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'] as const;

/**
 * Limites **atuais** (totais globais) por nível de dificuldade.
 * Ajuste aqui quando quiser aumentar ou diminuir a cota.
 */
const QUOTA_LIMITS: Record<(typeof DIFFICULTY_LEVELS)[number], number> = {
  easy:   600,
  medium: 370,
  hard:   280
};

const QUESTIONS_PER_TOPIC_LEVEL = 2;

// ---------------------------------------------------------------------------
//  UTILITÁRIOS DE CONTAGEM  (agora sem limite de 1 000 linhas)
// ---------------------------------------------------------------------------

/**
 * Conta quantas questões já existem para (topic, difficulty) usando `head: true`
 * => nenhum registro real é transferido; apenas o contador exato.
 */
async function getCount(topic: string, difficulty: string): Promise<number> {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { head: true, count: 'exact' })
    .eq('topic', topic)
    .eq('difficulty', difficulty);

  if (error) {
    console.error(`Erro ao contar questões de "${topic}" (${difficulty}):`, error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Imprime no console o panorama completo de (topic × difficulty) e devolve
 * um objeto com esses valores para uso posterior.
 */
async function checkCurrentQuestionCounts() {
  const topicLevelCounts: Record<string, Record<string, number>> = {};

  for (const topic of TOPICS) {
    topicLevelCounts[topic] = { easy: 0, medium: 0, hard: 0, total: 0 };

    for (const diff of DIFFICULTY_LEVELS) {
      const c = await getCount(topic, diff);
      topicLevelCounts[topic][diff] = c;
      topicLevelCounts[topic].total += c;
    }

    const { easy, medium, hard, total } = topicLevelCounts[topic];
    console.log(
      `Tópico "${topic}": ${total} questões (${easy} easy, ${medium} medium, ${hard} hard)`
    );
  }

  // Totais por nível
  console.log('\nTotais por nível:');
  for (const diff of DIFFICULTY_LEVELS) {
    const total = TOPICS.reduce((s, t) => s + topicLevelCounts[t][diff], 0);
    const limit = QUOTA_LIMITS[diff];
    console.log(`${diff}: ${total}/${limit} (${Math.floor((total / limit) * 100)}% completo)`);
  }

  return topicLevelCounts;
}

// ---------------------------------------------------------------------------
//  GERAÇÃO DE QUESTÃO / DICAS / SALVAMENTO
// ---------------------------------------------------------------------------

async function generateQuestion(topic: string, difficulty: string) {
  console.log(`Gerando questão sobre "${topic}" (nível ${difficulty})`);

  const apiKey = apiKeys[difficulty as keyof typeof apiKeys];
  if (!apiKey) throw new Error(`API key não encontrada para o nível ${difficulty}`);

  const prompt = `
Gere uma questão de álgebra sobre "${topic}" com nível de dificuldade "${difficulty}".
[… prompt completo igual ao seu, omitido aqui por brevidade …]
Formato JSON (sem texto adicional):
{
  "question": "Enunciado",
  "options": ["A", "B", "C", "D"],
  "correctOption": 0,
  "explanation": "…"
}`.trim();

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-reasoner',
      messages: [
        { role: 'system',
          content: 'Você é um professor de matemática especializado em álgebra...' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? '';

  // --- extração do JSON ---
  let qJson: any;
  try {
    qJson = JSON.parse(content.trim());
  } catch {
    const m = content.match(/({[\s\S]*})/);
    if (!m) throw new Error('Não foi possível extrair JSON da resposta.');
    qJson = JSON.parse(m[0]);
  }

  return {
    question:       qJson.question,
    options:        qJson.options,
    correctOption:  qJson.correctOption,
    explanation:    qJson.explanation,
    topic,
    difficulty,
    createdAt: new Date().toISOString()
  };
}

async function generateHints(question: any) {
  const hintsKey = apiKeys.hints;
  if (!hintsKey) return [];

  const prompt = `
Para a questão:
"${question.question}"
Crie três dicas progressivas…
Retorne somente ["dica1","dica2","dica3"]`.trim();

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hintsKey}` },
    body: JSON.stringify({
      model: 'deepseek-reasoner',
      messages: [
        { role: 'system', content: 'Você é um tutor de matemática…' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 500
    })
  });

  if (!res.ok) return [];
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';

  try {
    return JSON.parse(content.trim());
  } catch {
    const m = content.match(/\[(.*)\]/s);
    return m ? JSON.parse(`[${m[1]}]`) : [];
  }
}

async function saveQuestionToSupabase(question: any) {
  const { error } = await supabase.from('questions').insert([question]);
  if (error) throw new Error(`Erro ao salvar: ${error.message}`);
  console.log(`✔️  Questão salva: ${question.question.slice(0, 60)}…`);
}

// ---------------------------------------------------------------------------
//  MAIN
// ---------------------------------------------------------------------------

async function main() {
  console.log('🚀 Iniciando geração de questões com DeepSeek-Reasoner…');

  const countsStart = await checkCurrentQuestionCounts();
  const generated: any[] = [];

  for (const topic of TOPICS) {
    for (const diff of DIFFICULTY_LEVELS) {
      if (!apiKeys[diff]) continue; // sem chave → pula

      const totalDiffCount = TOPICS.reduce(
        (s, t) => s + countsStart[t][diff], 0);

      if (totalDiffCount >= QUOTA_LIMITS[diff]) continue; // cota global cheia

      const topicLimit = Math.ceil(QUOTA_LIMITS[diff] / TOPICS.length);
      const currentCount = countsStart[topic][diff];

      if (currentCount >= topicLimit) continue; // cota do tópico cheia

      const toGenerate = Math.min(
        QUESTIONS_PER_TOPIC_LEVEL,
        topicLimit - currentCount
      );

      for (let i = 0; i < toGenerate; i++) {
        try {
          // re-checa em tempo real
          const countNow = await getCount(topic, diff);
          if (countNow >= topicLimit) break;

          const q = await generateQuestion(topic, diff);
          const hints = await generateHints(q);
          if (hints.length) q.hints = hints;

          await saveQuestionToSupabase(q);
          generated.push(q);

          await new Promise(r => setTimeout(r, 1000)); // 1 s entre chamadas
        } catch (err: any) {
          console.error(`⚠️  ${topic} (${diff}):`, err.message);
        }
      }
    }
  }

  // ----- salva também num ficheiro local -----
  const outDir = 'questions-output';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const outPath = path.join(
    outDir,
    `questions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  fs.writeFileSync(outPath, JSON.stringify(generated, null, 2));

  console.log(`\nTotal gerado: ${generated.length}`);
  await checkCurrentQuestionCounts();
  console.log(`Arquivo salvo em: ${outPath}`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});

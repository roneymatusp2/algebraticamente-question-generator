import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

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
] as const;

const DIFFS = ['easy', 'medium', 'hard'] as const;
type Diff = (typeof DIFFS)[number];

const QUOTA: Record<Diff, number> = { easy: 600, medium: 370, hard: 280 };
console.log('*** DEBUG QUOTAS NO CÓDIGO TS ***:', QUOTA); // Linha de Debug Essencial
const QUESTIONS_PER_TOPIC_LEVEL = 2; // Mantido em 2, ajuste se desejar
const API_DELAY_MS = 1000;

async function count(topic: string, diff: Diff) {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { head: true, count: 'exact' })
    .eq('topic', topic)
    .eq('difficulty', diff);
  if (error) {
      console.error(`Erro ao contar ${topic} (${diff}): ${error.message}`);
      return 0;
  }
  return count ?? 0;
}

async function countAll() {
  const map: Record<string, Record<Diff | 'total', number>> = {};
  console.log('\n--- Verificando contagens atuais ---');
  for (const t of TOPICS) {
    map[t] = { easy: 0, medium: 0, hard: 0, total: 0 };
    for (const d of DIFFS) {
      const c = await count(t, d as Diff);
      map[t][d] = c;
      map[t].total += c;
    }
     console.log(`  ${t}: ${map[t].total} (${map[t].easy}e, ${map[t].medium}m, ${map[t].hard}h)`);
  }
   console.log('\n  Totais Globais Verificados:');
   for (const d of DIFFS) {
       const total = TOPICS.reduce((s, t) => s + (map[t]?.[d] ?? 0), 0);
       console.log(`    ${d}: ${total}/${QUOTA[d]}`);
   }
   console.log('--- Fim da verificação ---\n');
  return map;
}

async function generateQuestion(topic: string, diff: Diff) {
  console.log(`  Gerando questão: ${topic} (${diff})...`);
  const apiKey = apiKeys[diff];
  if (!apiKey) throw new Error(`API key inexistente para ${diff}`);
  const prompt = `
Gere uma questão de álgebra sobre "${topic}" com nível de dificuldade "${diff}" que seja clara e pedagógica.
Requisitos easy: conceitos fundamentais, inteiros pequenos, uma variável.
Requisitos medium: inteiros positivos ou negativos, até duas variáveis.
Requisitos hard: frações ou expoentes maiores, aplicação menos óbvia.
Formato JSON sem texto extra:
{
 "question":"...",
 "options":["A","B","C","D"],
 "correctOption":0,
 "explanation":"..."
}`.trim();

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: 'Professor de matemática especialista em álgebra. Responda APENAS com o JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Erro API DeepSeek (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  let parsed;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (jsonMatch && jsonMatch[0]) {
      try {
          parsed = JSON.parse(jsonMatch[0]);
      } catch (e: any) {
          console.error("Erro ao parsear JSON extraído:", e.message);
          console.error("Conteúdo recebido:", raw);
          throw new Error('Falha ao parsear JSON da resposta da API');
      }
  } else {
      console.error("Nenhum JSON encontrado:", raw);
      throw new Error('JSON inválido ou não encontrado na resposta');
  }

   if (!parsed.question || !parsed.options || !Array.isArray(parsed.options) || parsed.options.length < 2 || parsed.correctOption === undefined || typeof parsed.correctOption !== 'number' || parsed.correctOption < 0 || parsed.correctOption >= parsed.options.length || !parsed.explanation) {
         console.error("JSON recebido inválido:", parsed);
         throw new Error(`JSON recebido da API está incompleto ou mal formatado.`);
    }

  return {
    question: parsed.question,
    options: parsed.options,
    correctOption: parsed.correctOption,
    explanation: parsed.explanation,
    topic,
    difficulty: diff,
    createdAt: new Date().toISOString()
  };
}

async function generateHints(q: any) {
  console.log(`  Gerando hints para: ${q.question.slice(0, 30)}...`);
  const key = apiKeys.hints;
  if (!key) {
       console.log("  API key de hints não encontrada.");
       return [];
  }
  const prompt = `
Questão: "${q.question}" (Nível: ${q.difficulty})
Crie exatamente três dicas progressivas (inicial, intermediária, avançada) para ajudar a resolver esta questão.
Responda APENAS com um array JSON contendo as três strings das dicas. Exemplo: ["Dica 1", "Dica 2", "Dica 3"]`.trim();

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: 'Tutor de matemática. Responda APENAS com um array JSON de 3 strings.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 500
    })
  });

  if (!res.ok) {
      console.error(`  Erro API Hints (${res.status}): ${await res.text()}`);
      return [];
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  const arrayMatch = raw.match(/\[[\s\S]*\]/);

  if (arrayMatch && arrayMatch[0]) {
      try {
          const hintsArray = JSON.parse(arrayMatch[0]);
           if (Array.isArray(hintsArray) && hintsArray.length === 3 && hintsArray.every(h => typeof h === 'string')) {
                console.log("  Hints gerados.");
                return hintsArray;
            } else {
                 console.warn("  Formato de array de hints inválido:", hintsArray);
            }
      } catch (e: any) {
           console.error("  Erro ao parsear JSON de hints:", e.message);
           console.error("  Conteúdo recebido (hints):", raw);
      }
  } else {
       console.warn("  Nenhum array JSON encontrado (hints):", raw);
  }
  return [];
}

async function saveQuestion(q: any) {
  console.log(`  Salvando questão: ${q.question.slice(0, 50)}...`);
  const { error } = await supabase.from('questions').insert([q]);
  if (error) {
      console.error("  Erro Supabase ao salvar:", error);
      throw new Error(`Erro Supabase: ${error.message}`);
  }
   console.log("  ✔️ Salvo no Supabase.");
}

async function main() {
  console.log('🚀 Iniciando geração...');
  const startCounts = await countAll();
  const globalTotals: Record<Diff, number> = { easy: 0, medium: 0, hard: 0 };
  for (const d of DIFFS) {
      globalTotals[d] = TOPICS.reduce((s, t) => s + (startCounts[t]?.[d] ?? 0), 0);
  }
   console.log('Totais globais iniciais:', globalTotals);

  const createdQuestions: any[] = [];

  for (const topic of TOPICS) {
    for (const diff of DIFFS) {
      console.log(`\nVerificando: ${topic} (${diff})`);
      if (!apiKeys[diff]) {
          console.log("  API key não configurada. Pulando.");
          continue;
      }
      // *** LÓGICA DE LIMITE POR TÓPICO REMOVIDA ***
      // Verifica apenas a cota GLOBAL
      if (globalTotals[diff] >= QUOTA[diff]) {
          console.log(`  Cota global ${diff} (${globalTotals[diff]}/${QUOTA[diff]}) atingida. Pulando.`);
          continue;
      }

      let generatedInPass = 0;
      console.log(`  Tentando gerar até ${QUESTIONS_PER_TOPIC_LEVEL} questões...`);
      for (let i = 0; i < QUESTIONS_PER_TOPIC_LEVEL; i++) {
        // Re-verifica a cota global antes de cada tentativa
        if (globalTotals[diff] >= QUOTA[diff]) {
            console.log(`  Cota global ${diff} atingida durante as tentativas. Parando.`);
            break;
        }
        console.log(`  Tentativa ${i + 1}/${QUESTIONS_PER_TOPIC_LEVEL}...`);
        try {
          const q = await generateQuestion(topic, diff as Diff);
          const hints = await generateHints(q);
          if (hints.length === 3) {
            (q as any).hints = hints;
          } else if (hints.length > 0) {
              console.warn(`  Número inesperado de hints (${hints.length}) para a questão.`);
          }

          await saveQuestion(q);
          createdQuestions.push(q);
          globalTotals[diff]++; // Incrementa APÓS salvar
          generatedInPass++;
          console.log(`  Total global ${diff} atualizado: ${globalTotals[diff]}`);

        } catch (e: any) {
          console.error(`  ⚠️ Erro na tentativa ${i + 1} para ${topic} (${diff}): ${e.message}`);
        }
        // Delay mesmo se der erro
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      }
       if (generatedInPass > 0) {
           console.log(`  ${generatedInPass} questões geradas para ${topic} (${diff}) nesta passagem.`);
       } else if (globalTotals[diff] < QUOTA[diff]) {
            console.log(`  Nenhuma questão gerada para ${topic} (${diff}) nesta passagem.`);
       }

    }
  }

  console.log('\n--- Salvando arquivo local ---');
  const outputDir = 'questions-output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `questions-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(createdQuestions, null, 2));
  console.log(`Arquivo salvo em: ${outputPath}`);

  console.log('\n--- Geração Concluída ---');
  console.log(`Total de questões geradas NESTA EXECUÇÃO: ${createdQuestions.length}`);
  await countAll(); // Mostra contagens finais
  console.log('-------------------------\n');
}

main().catch(e => {
  console.error('\n❌ Erro fatal na execução principal:', e);
  process.exit(1);
});

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
type DifficultyLevel = typeof DIFFICULTY_LEVELS[number];

/**
 * Limites **globais** por nível de dificuldade. (CORRIGIDO)
 */
const QUOTA_LIMITS: Record<DifficultyLevel, number> = {
  easy:   600,
  medium: 370,
  hard:   280
};
console.log('DEBUG: Usando QUOTA_LIMITS:', QUOTA_LIMITS); // Para depuração

// Quantas questões tentar gerar por tópico/nível em CADA execução.
const QUESTIONS_TO_ATTEMPT_PER_RUN = 2;

// Delay em milissegundos entre chamadas à API para evitar rate limits
const API_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
//  UTILITÁRIOS DE CONTAGEM (CORRIGIDO para usar count exato)
// ---------------------------------------------------------------------------

/**
 * Conta quantas questões já existem para (topic, difficulty) usando `head: true`.
 */
async function getCount(topic: string, difficulty: DifficultyLevel): Promise<number> {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { head: true, count: 'exact' }) // Só pede a contagem exata
    .eq('topic', topic)
    .eq('difficulty', difficulty);

  if (error) {
    console.error(`Erro ao contar questões de "${topic}" (${difficulty}):`, error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Calcula e imprime o panorama completo de contagens usando getCount e retorna os totais globais. (CORRIGIDO)
 */
async function checkCurrentQuestionCounts(): Promise<Record<DifficultyLevel, number>> {
  console.log('\n--- Iniciando verificação de contagem detalhada ---');
  const topicLevelCounts: Record<string, Record<DifficultyLevel | 'total', number>> = {};
  const globalTotals: Record<DifficultyLevel, number> = { easy: 0, medium: 0, hard: 0 };

  for (const topic of TOPICS) {
    topicLevelCounts[topic] = { easy: 0, medium: 0, hard: 0, total: 0 };

    for (const diff of DIFFICULTY_LEVELS) {
      const count = await getCount(topic, diff); // Usa a função corrigida
      topicLevelCounts[topic][diff] = count;
      topicLevelCounts[topic].total += count;
      globalTotals[diff] += count;
    }

    const { easy, medium, hard, total } = topicLevelCounts[topic];
    console.log(
      `  Tópico "${topic}": ${total} questões (${easy} easy, ${medium} medium, ${hard} hard)`
    );
  }

  console.log('\n  Totais globais por nível:');
  for (const diff of DIFFICULTY_LEVELS) {
    const total = globalTotals[diff];
    const limit = QUOTA_LIMITS[diff];
    const percentage = limit > 0 ? Math.floor((total / limit) * 100) : 100;
    console.log(`    ${diff}: ${total}/${limit} questões (${percentage}% completo)`);
  }
  console.log('--- Fim da verificação de contagem ---\n');
  return globalTotals;
}

// ---------------------------------------------------------------------------
//  GERAÇÃO DE QUESTÃO / DICAS / SALVAMENTO (sem alterações significativas aqui)
// ---------------------------------------------------------------------------

async function generateQuestion(topic: string, difficulty: DifficultyLevel) {
    console.log(`  Gerando questão sobre "${topic}" (nível: ${difficulty})...`);
    const apiKey = apiKeys[difficulty];
    if (!apiKey) {
        throw new Error(`API key não encontrada para o nível ${difficulty}`);
    }

    const prompt = `
Gere uma questão de álgebra sobre "${topic}" com nível de dificuldade "${difficulty}" que seja clara, educativa e apropriada para acompanhar o progresso de aprendizagem do aluno.

Requisitos:
- Para nível "easy": introduza os conceitos fundamentais de ${topic} com operações diretas e números inteiros positivos pequenos. Use apenas uma variável. As questões devem servir como primeiro contato com o conceito.
- Para nível "medium": explore aplicações mais elaboradas de ${topic} usando números inteiros (positivos/negativos) e até duas variáveis. As questões devem consolidar o conhecimento e exigir mais passos para solução.
- Para nível "hard": desafie o aluno com problemas que exigem domínio completo de ${topic}, podendo envolver frações, expoentes maiores ou aplicações menos óbvias do conceito. As questões devem indicar maestria no assunto.

Sobre a progressão educativa:
- A questão deve permitir uma avaliação clara do entendimento do aluno sobre o tópico
- As alternativas incorretas devem representar erros comuns de compreensão ou aplicação
- A explicação deve ser pedagógica, mostrando cada passo do raciocínio de forma clara

Regras:
- Use notação algébrica padronizada e clara (e.g., x², x³, etc.)
- Evite ambiguidades na formulação da questão
- Certifique-se que apenas uma resposta está correta
- Inclua contexto quando relevante para facilitar o entendimento

Formato JSON (responda APENAS com o JSON, sem nenhum texto antes ou depois):
{
  "question": "Enunciado da questão",
  "options": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"],
  "correctOption": 0,
  "explanation": "Solução passo a passo detalhada"
}
    `; // Prompt ajustado para pedir APENAS JSON

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-coder', // Modelo talvez mais focado em formato estruturado
            messages: [
                { role: 'system', content: 'Você é um professor de matemática especializado em álgebra. Sua tarefa é gerar uma questão no formato JSON especificado, sem adicionar nenhum texto fora do JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.6, // Um pouco menos de variabilidade
            max_tokens: 1200
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erro na API DeepSeek (${response.status}): ${text}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';

    if (!content) {
        throw new Error('Resposta vazia da API DeepSeek');
    }

    // Tentativa robusta de extrair JSON
    let questionJson;
    const jsonMatch = content.match(/\{[\s\S]*\}/); // Tenta encontrar o primeiro bloco JSON

    if (jsonMatch && jsonMatch[0]) {
         try {
             questionJson = JSON.parse(jsonMatch[0]);
         } catch (e: any) {
            console.error("Erro ao parsear JSON extraído:", e.message);
            console.error("Conteúdo recebido:", content);
            throw new Error(`Falha ao parsear JSON da resposta da API: ${content}`);
         }
    } else {
         console.error("Nenhum bloco JSON encontrado na resposta:", content);
         throw new Error(`Não foi possível encontrar um JSON válido na resposta da API: ${content}`);
    }

    // Validar estrutura básica do JSON recebido
    if (!questionJson.question || !questionJson.options || !Array.isArray(questionJson.options) || questionJson.options.length < 2 || questionJson.correctOption === undefined || typeof questionJson.correctOption !== 'number' || questionJson.correctOption < 0 || questionJson.correctOption >= questionJson.options.length || !questionJson.explanation) {
         console.error("JSON recebido inválido:", questionJson);
         throw new Error(`JSON recebido da API está incompleto ou mal formatado.`);
    }

    const questionData = {
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


async function generateHints(question: any): Promise<string[]> {
    const hintsApiKey = apiKeys.hints;
    if (!hintsApiKey) {
        console.log('  API key para dicas não encontrada. Pulando hints.');
        return [];
    }
    console.log(`  Gerando hints para: ${question.question.slice(0,30)}...`);

    const prompt = `
Para a seguinte questão de álgebra sobre "${question.topic}" (nível ${question.difficulty}):
Questão: "${question.question}"
Opções: ${JSON.stringify(question.options)}

Crie exatamente três dicas pedagógicas progressivas:
1. Dica inicial sutil (direciona o pensamento).
2. Dica intermediária (esclarece o conceito/método principal).
3. Dica avançada (indica o caminho da solução, sem dar a resposta).

Responda APENAS com um array JSON contendo as três strings das dicas, como neste exemplo: ["Pense sobre a propriedade distributiva.", "Lembre-se de como multiplicar potências de mesma base.", "Combine os termos semelhantes após a multiplicação."]
`; // Prompt mais direto pedindo apenas o array

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hintsApiKey}` },
            body: JSON.stringify({
                model: 'deepseek-coder', // Pode ser diferente
                messages: [
                    { role: 'system', content: 'Você é um tutor de matemática. Responda APENAS com um array JSON de 3 strings contendo as dicas solicitadas.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.4,
                max_tokens: 400
            })
        });

        if (!response.ok) {
            console.error(`  Erro na API DeepSeek ao gerar hints (${response.status}): ${await response.text()}`);
            return [];
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';

        if (!content) {
            console.warn("  Resposta de hints vazia da API.");
            return [];
        }

        // Tentativa robusta de extrair array JSON
        const arrayMatch = content.match(/\[[\s\S]*\]/); // Tenta encontrar o primeiro array JSON
        if (arrayMatch && arrayMatch[0]) {
            try {
                const hintsArray = JSON.parse(arrayMatch[0]);
                if (Array.isArray(hintsArray) && hintsArray.length === 3 && hintsArray.every(h => typeof h === 'string')) {
                    console.log("  Hints gerados com sucesso.");
                    return hintsArray;
                } else {
                    console.warn("  Formato de array de hints inválido recebido:", hintsArray);
                }
            } catch (e: any) {
                 console.error("  Erro ao parsear JSON de hints:", e.message);
                 console.error("  Conteúdo recebido para hints:", content);
            }
        } else {
             console.warn("  Nenhum array JSON encontrado na resposta de hints:", content);
        }
        return []; // Retorna vazio se falhar

    } catch (err: any) {
        console.error('  Erro inesperado ao gerar hints:', err.message);
        return [];
    }
}


async function saveQuestionToSupabase(question: any) {
    console.log(`  Salvando questão: ${question.question.slice(0, 50)}...`);
    const { data, error } = await supabase
        .from('questions')
        .insert([question]);

    if (error) {
        console.error("  Erro ao salvar no Supabase:", error);
        throw new Error(`Erro ao salvar questão no Supabase: ${error.message}`);
    }
    console.log(`  ✔️ Questão salva com sucesso no Supabase.`);
    return data;
}

// ---------------------------------------------------------------------------
//  FUNÇÃO PRINCIPAL (MAIN) - Lógica SEM topicLimit (CORRIGIDO)
// ---------------------------------------------------------------------------
async function main() {
    console.log('🚀 Iniciando geração de questões...');

    // 1. Obter contagens iniciais e totais globais (usando a função corrigida)
    let currentGlobalTotals = await checkCurrentQuestionCounts();
    const generatedQuestions = []; // Armazena questões geradas nesta execução

    // 2. Iterar sobre tópicos e dificuldades
    for (const topic of TOPICS) {
        for (const difficulty of DIFFICULTY_LEVELS) {

            console.log(`\nVerificando ${topic} (${difficulty})`);

            // 3. Verificar API Key
            if (!apiKeys[difficulty]) {
                console.log(`  API key não configurada para ${difficulty}. Pulando.`);
                continue;
            }

            // 4. Verificar COTA GLOBAL para esta dificuldade
            if (currentGlobalTotals[difficulty] >= QUOTA_LIMITS[difficulty]) {
                console.log(`  Cota GLOBAL para ${difficulty} (${currentGlobalTotals[difficulty]}/${QUOTA_LIMITS[difficulty]}) atingida. Pulando.`);
                continue; // Pula para a próxima dificuldade/tópico
            }

            // ----- REMOVIDA A LÓGICA DE topicLimit -----

            // 5. Tentar gerar 'QUESTIONS_TO_ATTEMPT_PER_RUN' questões
            console.log(`  Tentando gerar até ${QUESTIONS_TO_ATTEMPT_PER_RUN} questões...`);
            let generatedInThisPass = 0;
            for (let i = 0; i < QUESTIONS_TO_ATTEMPT_PER_RUN; i++) {

                // 6. RE-VERIFICAR a cota global ANTES de cada tentativa
                if (currentGlobalTotals[difficulty] >= QUOTA_LIMITS[difficulty]) {
                    console.log(`  Cota GLOBAL para ${difficulty} atingida durante o processo. Parando para este tópico/nível.`);
                    break; // Sai do loop interno (for i)
                }

                console.log(`  Tentativa ${i + 1}/${QUESTIONS_TO_ATTEMPT_PER_RUN}...`);
                try {
                    // Gerar a questão
                    const question = await generateQuestion(topic, difficulty);

                    // Gerar dicas
                    const hints = await generateHints(question);
                    if (hints.length === 3) {
                        (question as any).hints = hints;
                    } else if (hints.length > 0) {
                         console.warn(`  Número inesperado de hints (${hints.length}) recebido para a questão.`);
                         // Decide se quer salvar mesmo assim ou descartar
                         // (question as any).hints = hints; // Opção: salvar mesmo se não forem 3
                    }

                    // Salvar no Supabase
                    await saveQuestionToSupabase(question);

                    // Atualizar contagem global e estado local
                    generatedQuestions.push(question);
                    currentGlobalTotals[difficulty]++; // Incrementa o total global APÓS salvar
                    generatedInThisPass++;
                    console.log(`  Total global ${difficulty} agora: ${currentGlobalTotals[difficulty]}`);

                    // Pausa para evitar sobrecarga da API
                    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));

                } catch (err: any) {
                    // Loga o erro mas continua para a próxima tentativa/tópico
                    console.error(`  ⚠️ Erro ao gerar/salvar questão [${topic} - ${difficulty}]: ${err.message}`);
                    // Considerar adicionar um delay maior após um erro
                    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS * 2));
                    // break; // Descomente se quiser parar para este tópico/nível após um erro
                }
            }
             if (generatedInThisPass === 0 && currentGlobalTotals[difficulty] < QUOTA_LIMITS[difficulty]) {
                 console.log(`  Nenhuma questão nova gerada para ${topic} (${difficulty}) nesta passagem (possivelmente devido a erros).`);
             } else if (generatedInThisPass > 0) {
                 console.log(`  ${generatedInThisPass} questões geradas para ${topic} (${difficulty}) nesta passagem.`);
             }
        } // Fim do loop difficulty
    } // Fim do loop topic

    // 7. Salvar log local (opcional)
    const outputDir = 'questions-output';
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `questions-${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(generatedQuestions, null, 2));

    // 8. Imprimir resumo final
    console.log('\n--- Geração Concluída ---');
    console.log(`Total de questões geradas NESTA EXECUÇÃO: ${generatedQuestions.length}`);
    console.log(`Arquivo JSON com as novas questões salvo em: ${outputPath}`);
    await checkCurrentQuestionCounts(); // Mostra as contagens finais
     console.log('-------------------------\n');

}

// Executa a função principal e trata erros fatais
main().catch((err) => {
    console.error('\n❌ Erro fatal na execução principal:', err);
    process.exit(1);
});

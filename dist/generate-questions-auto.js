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
const QUOTA_LIMITS = {
    easy: 500,
    medium: 350,
    hard: 250
};
const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];
const QUESTIONS_PER_TOPIC_LEVEL = 2;
async function checkCurrentQuestionCounts() {
    console.log('Verificando contagem detalhada de questões por tópico e nível...');
    const topicLevelCounts = {};
    TOPICS.forEach(topic => {
        topicLevelCounts[topic] = { easy: 0, medium: 0, hard: 0, total: 0 };
    });
    const { data, error } = await supabase
        .from('questions')
        .select('topic, difficulty');
    if (error) {
        console.error('Erro ao obter contagem:', error.message);
        return topicLevelCounts;
    }
    if (data && data.length > 0) {
        for (const question of data) {
            const topic = question.topic;
            const difficulty = question.difficulty?.toLowerCase() || '';
            if (topicLevelCounts[topic] && DIFFICULTY_LEVELS.includes(difficulty)) {
                topicLevelCounts[topic][difficulty]++;
                topicLevelCounts[topic].total++;
            }
        }
    }
    const difficultyTotals = { easy: 0, medium: 0, hard: 0 };
    for (const topic of TOPICS) {
        const counts = topicLevelCounts[topic];
        console.log(`Tópico "${topic}": ${counts.total} questões (${counts.easy} easy, ${counts.medium} medium, ${counts.hard} hard)`);
        DIFFICULTY_LEVELS.forEach(diff => {
            difficultyTotals[diff] += counts[diff];
        });
    }
    console.log('\nTotais por nível:');
    DIFFICULTY_LEVELS.forEach(diff => {
        const total = difficultyTotals[diff];
        const limit = QUOTA_LIMITS[diff];
        console.log(`${diff}: ${total}/${limit} questões (${Math.floor(total / limit * 100)}% completo)`);
    });
    return topicLevelCounts;
}
async function getQuestionCountForTopicAndDifficulty(topic, difficulty) {
    const { data, error, count } = await supabase
        .from('questions')
        .select('id', { count: 'exact' })
        .eq('topic', topic)
        .eq('difficulty', difficulty);
    if (error) {
        console.error(`Erro ao contar questões para ${topic} (${difficulty}):`, error.message);
        return 0;
    }
    return count || 0;
}
async function generateQuestion(topic, difficulty) {
    console.log(`Gerando questão sobre "${topic}" (nível: ${difficulty})`);
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
  
  Formato JSON (sem texto adicional):
  {
    "question": "Enunciado da questão",
    "options": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"],
    "correctOption": 0,
    "explanation": "Solução passo a passo detalhada"
  }
  `;
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-reasoner',
            messages: [
                { role: 'system', content: 'Você é um professor de matemática especializado em álgebra, focado em criar questões de alta qualidade para o aprendizado progressivo dos alunos.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 1000
        })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erro na API DeepSeek: ${response.status} - ${text}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (!content) {
        throw new Error('Resposta vazia ou inválida da API DeepSeek');
    }
    let questionJson;
    try {
        questionJson = JSON.parse(content.trim());
    }
    catch {
        const match = content.match(/({[\s\S]*})/);
        if (match) {
            questionJson = JSON.parse(match[0]);
        }
        else {
            throw new Error('Não foi possível extrair JSON da resposta.');
        }
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
async function generateHints(question) {
    const hintsApiKey = apiKeys.hints;
    if (!hintsApiKey) {
        console.log('API key para dicas não encontrada. Pulando geração de hints.');
        return [];
    }
    const prompt = `
    Para a seguinte questão de álgebra sobre "${question.topic}" (nível ${question.difficulty}):
    "${question.question}"

    Crie três dicas pedagógicas progressivas que ajudem o aluno a construir seu raciocínio:
    1. Uma dica inicial sutil que direcione o pensamento sem revelar o método de solução
    2. Uma dica intermediária que esclareça o conceito matemático envolvido
    3. Uma dica avançada que praticamente indique o caminho da solução, sem dar a resposta direta
    
    As dicas devem funcionar como um andaime de aprendizagem, permitindo que o aluno perceba seu progresso.
    
    Responda somente com um array JSON: ["dica1", "dica2", "dica3"]
  `;
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hintsApiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-reasoner',
            messages: [
                { role: 'system', content: 'Você é um tutor de matemática especializado em criar dicas progressivas que auxiliam o aprendizado sem entregar a resposta.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 500
        })
    });
    if (!response.ok) {
        console.error('Erro ao gerar dicas:', response.statusText);
        return [];
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (!content) {
        return [];
    }
    try {
        return JSON.parse(content.trim());
    }
    catch {
        const match = content.match(/\[(.*?)\]/s);
        if (match) {
            try {
                return JSON.parse(`[${match[1]}]`);
            }
            catch {
                return [];
            }
        }
        return [];
    }
}
async function saveQuestionToSupabase(question) {
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
    console.log('Iniciando geração de questões com DeepSeek-Reasoner...');
    const topicLevelCounts = await checkCurrentQuestionCounts();
    const generatedQuestions = [];
    for (const topic of TOPICS) {
        for (const difficulty of DIFFICULTY_LEVELS) {
            if (!apiKeys[difficulty]) {
                console.log(`Pulando ${topic} (${difficulty}) - API key não configurada.`);
                continue;
            }
            const currentCount = await getQuestionCountForTopicAndDifficulty(topic, difficulty);
            const difficultyTotalLimit = QUOTA_LIMITS[difficulty];
            const totalDifficultyCount = TOPICS.reduce((sum, t) => {
                return sum + (topicLevelCounts[t]?.[difficulty] || 0);
            }, 0);
            if (totalDifficultyCount >= difficultyTotalLimit) {
                console.log(`Pulando ${topic} (${difficulty}) - Cota total do nível atingida (${totalDifficultyCount}/${difficultyTotalLimit})`);
                continue;
            }
            const topicLimit = Math.ceil(difficultyTotalLimit / TOPICS.length);
            if (currentCount >= topicLimit) {
                console.log(`Pulando ${topic} (${difficulty}) - Cota do tópico atingida (${currentCount}/${topicLimit})`);
                continue;
            }
            const questionsToGenerate = Math.min(QUESTIONS_PER_TOPIC_LEVEL, topicLimit - currentCount);
            if (questionsToGenerate <= 0)
                continue;
            console.log(`Gerando ${questionsToGenerate} questões para ${topic} (nível ${difficulty})...`);
            for (let i = 0; i < questionsToGenerate; i++) {
                try {
                    const currentCountCheck = await getQuestionCountForTopicAndDifficulty(topic, difficulty);
                    if (currentCountCheck >= topicLimit) {
                        console.log(`Pulando geração - verificação em tempo real detectou que cota foi atingida para ${topic} (${difficulty})`);
                        break;
                    }
                    const question = await generateQuestion(topic, difficulty);
                    const hints = await generateHints(question);
                    if (hints.length > 0) {
                        question.hints = hints;
                    }
                    await saveQuestionToSupabase(question);
                    generatedQuestions.push(question);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
                catch (err) {
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
    const finalCounts = await checkCurrentQuestionCounts();
    console.log(`\nTotal de questões geradas: ${generatedQuestions.length}`);
    console.log(`Arquivo JSON salvo em: ${outputPath}`);
}
main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
});

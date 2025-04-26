import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'
import fs from 'node:fs'
import path from 'node:path'

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
)

const apiKeys = {
  easy: process.env.DEEPSEEK_API_KEY_EASY,
  medium: process.env.DEEPSEEK_API_KEY_MEDIUM,
  hard: process.env.DEEPSEEK_API_KEY_HARD,
  feedback: process.env.DEEPSEEK_API_KEY_FEEDBACK,
  hints: process.env.DEEPSEEK_API_KEY_HINTS
}

const API_URL = 'https://api.deepseek.com/v1/chat/completions'

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
] as const

const DIFFS = ['easy', 'medium', 'hard'] as const
type Diff = (typeof DIFFS)[number]

const QUOTA: Record<Diff, number> = { easy: 600, medium: 370, hard: 280 }
const QUESTIONS_PER_TOPIC_LEVEL = 2

async function count(topic: string, diff: Diff) {
  const { count } = await supabase
    .from('questions')
    .select('id', { head: true, count: 'exact' })
    .eq('topic', topic)
    .eq('difficulty', diff)
  return count ?? 0
}

async function countAll() {
  const map: Record<string, Record<Diff | 'total', number>> = {}
  for (const t of TOPICS) {
    map[t] = { easy: 0, medium: 0, hard: 0, total: 0 }
    for (const d of DIFFS) {
      const c = await count(t, d as Diff)
      map[t][d] = c
      map[t].total += c
    }
  }
  return map
}

async function generateQuestion(topic: string, diff: Diff) {
  const apiKey = apiKeys[diff]
  if (!apiKey) throw new Error(`API key inexistente para ${diff}`)
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
}`.trim()
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-reasoner',
      messages: [
        { role: 'system', content: 'Professor de matemática especialista em álgebra.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`)
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content ?? ''
  let parsed
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    const m = raw.match(/({[\s\S]*})/)
    if (!m) throw new Error('JSON inválido')
    parsed = JSON.parse(m[0])
  }
  return {
    question: parsed.question,
    options: parsed.options,
    correctOption: parsed.correctOption,
    explanation: parsed.explanation,
    topic,
    difficulty: diff,
    createdAt: new Date().toISOString()
  }
}

async function generateHints(q: any) {
  const key = apiKeys.hints
  if (!key) return []
  const prompt = `
"${q.question}"
Crie três dicas progressivas em array JSON.`.trim()
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-reasoner',
      messages: [
        { role: 'system', content: 'Tutor de matemática.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 500
    })
  })
  if (!res.ok) return []
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content ?? ''
  try {
    return JSON.parse(raw.trim())
  } catch {
    const m = raw.match(/\[(.*)\]/s)
    return m ? JSON.parse(`[${m[1]}]`) : []
  }
}

async function saveQuestion(q: any) {
  const { error } = await supabase.from('questions').insert([q])
  if (error) throw new Error(error.message)
}

async function main() {
  const start = await countAll()
  const global: Record<Diff, number> = { easy: 0, medium: 0, hard: 0 }
  for (const d of DIFFS) global[d] = TOPICS.reduce((s, t) => s + start[t][d], 0)
  const created: any[] = []
  for (const topic of TOPICS) {
    for (const diff of DIFFS) {
      if (!apiKeys[diff]) continue
      if (global[diff] >= QUOTA[diff]) continue
      for (let i = 0; i < QUESTIONS_PER_TOPIC_LEVEL; i++) {
        if (global[diff] >= QUOTA[diff]) break
        try {
          const q = await generateQuestion(topic, diff as Diff)
          const hints = await generateHints(q)
          if (hints.length) q.hints = hints
          await saveQuestion(q)
          created.push(q)
          global[diff]++
        } catch (e) {
          console.error(e)
        }
        await new Promise(r => setTimeout(r, 800))
      }
    }
  }
  if (!fs.existsSync('questions-output')) fs.mkdirSync('questions-output')
  fs.writeFileSync(
    path.join('questions-output', `questions-${Date.now()}.json`),
    JSON.stringify(created, null, 2)
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

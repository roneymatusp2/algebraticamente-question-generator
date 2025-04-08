# Gerador Automatizado de Questões Matemáticas

Este repositório contém o sistema automatizado para geração de questões matemáticas para o projeto Algebraticamente, utilizando a API DeepSeek e GitHub Actions para execução automática diária.

## Funcionamento

- O script `generate-questions-auto.js` é executado diariamente às 2h da manhã pelo GitHub Actions
- São geradas questões para 6 tópicos matemáticos diferentes
- Cada tópico recebe questões em 3 níveis de dificuldade (fácil, médio e difícil)
- As questões são enviadas automaticamente para o banco de dados Supabase

## Tópicos Matemáticos

- Polinômios
- Funções
- Geometria Analítica
- Trigonometria
- Matrizes
- Álgebra Linear

## Tecnologias Utilizadas

- GitHub Actions para automação
- Node.js para execução do script
- Supabase como banco de dados
- API DeepSeek para geração de questões com IA

## Configuração

Para utilizar este repositório, é necessário configurar os seguintes secrets no GitHub:

- `SUPABASE_URL`: URL do seu projeto Supabase
- `SUPABASE_SERVICE_KEY`: Chave de serviço do Supabase
- `DEEPSEEK_API_KEY_EASY`: Chave API DeepSeek para questões fáceis
- `DEEPSEEK_API_KEY_MEDIUM`: Chave API DeepSeek para questões médias
- `DEEPSEEK_API_KEY_HARD`: Chave API DeepSeek para questões difíceis
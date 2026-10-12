# Bunpou Lab

Aplicação web para estudar e praticar gramática japonesa do JLPT N5. O conteúdo é organizado em pontos gramaticais, cada um com explicação, exemplos e exercícios. A prática é montada a partir do que você já liberou e do que precisa revisar.

## Site

[https://bunpou-lab.netlify.app/](https://bunpou-lab.netlify.app/)

## Recursos

**Tipos de exercício**

- Múltipla escolha.
- Ordenação no formato ★ (並べかえ): monte a frase mentalmente e indique o fragmento que fica na posição ★.
- Textos com lacunas, em que cada lacuna é decidida pelo contexto.

**Modos de prática**

- **Sessão de gramática**: dividida em etapas (recuperação, reconhecimento e contraste, contexto, ordenação ★, erros e consolidação). Dura 15, 30, 45 ou 60 minutos.
- **Prática rápida**: 5 ou 10 minutos, só com múltipla escolha.
- **Mini JLPT — Gramática**: versão curta da seção de gramática da prova, com 10 questões de múltipla escolha, 3 de ordenação ★ e 1 texto com lacunas.
- **Outros**: revisão mista, pontos fracos e prática de um ponto, de uma lição ou de uma fonte inteira.

**Correção e revisão**

- Feedback depois de cada resposta: a resposta correta, por que a alternativa escolhida não serve, o ponto-chave, a regra usada e outro exemplo. Quando faz sentido, também mostra um contraste com uma estrutura parecida.
- Botão "Não sei", que mostra a explicação e marca o ponto para revisão.
- Botão "Chutei", para registrar um acerto feito sem certeza.
- Revisão espaçada: cada ponto gramatical tem um estado (novo, em aprendizagem, fraco, consolidando, forte, consolidado), e o que foi errado volta nas próximas sessões.

**Conteúdo e progresso**

- Fichas dos pontos gramaticais com estrutura, uso, exemplos, erros comuns e dicas.
- Ajustes para escolher as fontes de estudo e quais lições ou conjuntos de questões estão liberados.
- Indicação da origem de cada atividade.
- Página de progresso.
- Atalhos de teclado:
  - `1`–`4` escolhem a alternativa;
  - `Enter` responde e, depois da correção, avança;
  - `Esc` fecha painéis.
- O progresso fica salvo no navegador. Login com Google é opcional e serve para sincronizar o progresso entre dispositivos.

## Fontes de estudo

Os pontos gramaticais e a sequência de estudo foram organizados com apoio destes materiais:

- Introdutório Rikai e Básico 1 Rikai (Marugoto A1 e A2 りかい);
- Nihongo no Kotsu;
- TRY! N5;
- JLPT Official Practice Workbook e provas anteriores do JLPT N5.

O conteúdo tem três origens diferentes, e cada atividade indica a sua:

- **Autoral**: explicações, feedbacks e exercícios escritos para o Bunpou Lab. Não são conteúdo oficial do JLPT nem dos materiais citados.
- **Adaptado ou baseado em materiais de estudo**: exercícios ligados às lições do Rikai, do Nihongo no Kotsu e do TRY! N5.
- **Practice Workbook e provas**: questões de gramática do Practice Workbook e de provas JLPT N5. Mantêm o enunciado, as alternativas e o gabarito originais e indicam o conjunto e o número da questão. As explicações que acompanham essas questões são do Bunpou Lab.

## Tecnologias

- **HTML, CSS e JavaScript**, sem framework. A aplicação inteira está em `index.html`.
- **Vite**, usado só para empacotar o módulo de login e sincronização (`src/auth-sync.js`).
- **Netlify**: hospedagem, Netlify Identity (login com Google), Netlify Functions e Netlify Database (tabela de progresso por usuário).
- **TypeScript**, na função de sincronização (`netlify/functions/progress.mts`).
- **Google Fonts** (Shippori Mincho e Zen Kaku Gothic New).

## Executando localmente

Requer Node.js. O build no Netlify usa a versão 20.

Instalar as dependências:

```bash
npm install
```

Iniciar o servidor de desenvolvimento:

```bash
npm run dev
```

Gerar o build de produção (em `dist/`) e visualizá-lo:

```bash
npm run build
npm run preview
```

Login e sincronização dependem dos serviços do Netlify (Identity, Functions e Database). Sem eles, a aplicação continua funcionando com o progresso salvo no navegador.

## Estrutura do projeto

```text
bunpou-lab/
├── index.html
├── src/
│   └── auth-sync.js
├── netlify/
│   ├── functions/
│   │   └── progress.mts
│   └── database/
│       └── migrations/
├── netlify.toml
├── package.json
└── vite.config.js
```

- `index.html`: a aplicação inteira (interface, conteúdo gramatical, exercícios e lógica de prática e revisão).
- `src/auth-sync.js`: login com Google e sincronização do progresso com a conta.
- `netlify/functions/progress.mts`: função que lê e grava o progresso do usuário autenticado.
- `netlify/database/migrations/`: criação da tabela de progresso.
- `netlify.toml`: configuração de build e publicação no Netlify.
- `package.json`: dependências e scripts.
- `vite.config.js`: configuração do build.

## Status do projeto

O projeto está em uso ativo para o estudo do JLPT N5 e recebe ajustes conforme problemas reais aparecem durante a prática.

## Autoria

Projeto mantido pela organização Solisfeeld.

## Aviso

O JLPT (Japanese-Language Proficiency Test) é aplicado pela Japan Foundation e pela Japan Educational Exchanges and Services (JEES). O Bunpou Lab é um projeto independente: não é oficial e não tem afiliação com as organizações responsáveis pelo exame, nem com as editoras ou os autores dos materiais citados. Os materiais externos mantêm os direitos de seus respectivos autores e proprietários.

# Game Fight Demo

Jogo de luta 1x1 com:

- selecao de personagem
- modo jogador vs CPU
- modo jogador vs jogador online
- rounds (melhor de 3)

## O que mudou

O multiplayer agora usa dois caminhos:

- **local/dev**: `server.js` com **WebSocket** em tempo real
- **Vercel/producao**: `api/rooms.js` com **HTTP + polling**

Isso evita a tentativa de abrir `wss://gamefightdemo.vercel.app/ws` na Vercel, porque conexoes WebSocket persistentes nao sao suportadas ali.

## Arquitetura

- Frontend: `index.html`, `styles.css`, `game.js`
- Backend local: `server.js` com `ws`
- Backend Vercel: `api/rooms.js`
- Persistencia:
  - producao: Upstash Redis (`@upstash/redis`) para sincronizacao entre instancias
  - fallback local/dev: memoria em processo

Fluxo online:

1. Host cria sala (`type: create`)
2. Guest entra na sala (`type: join`)
3. Guest envia comandos/input (`type: command` e `type: input`)
4. Host simula partida e envia snapshots (`type: state`)
5. Guest renderiza snapshots via socket no modo local ou via polling HTTP na Vercel

## SEO e descoberta

- Metadados completos (Open Graph, Twitter, FAQ e `VideoGame` JSON-LD) adicionados em `index.html`.
- Sessões de conteúdo textual (`#sobre`, `#llm-briefing`, `#faq`) fornecem contexto para buscadores e LLMs.
- Arquivos de suporte criados: `robots.txt`, `sitemap.xml`, `.well-known/ai-plugin.json`, `.well-known/llm-manifest.json` e `openapi.yaml`.
- `server.js` agora envia tipos de conteúdo adequados para `.json`, `.xml`, `.yaml` e `.txt`.

## Estrutura de assets

O jogo tenta carregar sprites a partir de `AssetsGame`:

```text
AssetsGame/
  Fighter/
    idle.png
    walk.png
    jump.png
    Attack_1.png
    Attack_2.png
    hurt.png
    Dead..png
  Samurai/
    ...
  Shinobi/
    ...
  Converted_Vampire/
    ...
  Countess_Vampire/
    ...
  Gotoku/
    ...
  Onre/
    ...
  Vampire_Girl/
    ...
  Yurei/
    ...
```

Cada imagem deve ser spritesheet horizontal com a animacao da acao.

## Executar localmente

Pre-requisitos:

- Node.js 20+

Passos:

1. `npm install`
2. `npm run dev`
3. Abrir `http://localhost:3000`

Controles:

- `A/D`: mover
- `W`: pular
- `J`: ataque 1
- `K`: ataque 2

## Deploy na Vercel (producao)

### 1) Subir projeto

Conecte o repositorio na Vercel e mantenha a branch desejada.

### 2) Criar Redis no Upstash

No dashboard do Upstash:

1. Crie uma base Redis
2. Copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`

### 3) Variaveis de ambiente

A Vercel injeta automaticamente, quando configuradas no projeto:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Sem Redis, o backend cai em memoria local (nao recomendado para producao distribuida).

### 4) Deploy

Faca o deploy normal do projeto na Vercel.

Observacao: nao existe ajuste em `vercel.json` que "suba" o `/ws` na Vercel. O deploy na Vercel usa a rota serverless `api/rooms.js` e o cliente faz polling HTTP. Se quiser WebSocket de verdade em producao, suba `server.js` em outro host Node e aponte o cliente para esse servidor.

## Backend WebSocket

- HTTP: arquivos estaticos em `/`
- WebSocket: `ws://host/ws` (ou `wss://` em HTTPS), somente quando `server.js` estiver rodando em um host Node persistente
- Na Vercel, use `api/rooms.js` e polling HTTP em vez de `/ws`

## Observacoes importantes

- Multiplayer exige `http://` ou `https://` (nao funciona em `file://`)
- O host e autoridade da simulacao
- Guest envia somente input/comandos; estado final vem do snapshot do host
- Salas expiram automaticamente por TTL no backend


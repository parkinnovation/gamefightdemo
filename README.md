# Game Fight Demo

Jogo de luta 1x1 com:

- selecao de personagem
- modo jogador vs CPU
- modo jogador vs jogador online
- rounds (melhor de 3)

## O que mudou

O multiplayer agora usa **backend Node** em `api/rooms.js` (Vercel Function), em vez de `BroadcastChannel/localStorage`.

Com isso:

- funciona entre navegadores diferentes
- funciona entre maquinas/dispositivos diferentes
- nao depende mais de abas da mesma origem

## Arquitetura

- Frontend: `index.html`, `styles.css`, `game.js`
- Backend Node (serverless): `api/rooms.js`
- Persistencia:
  - producao: Upstash Redis (`@upstash/redis`) para sincronizacao entre instancias
  - fallback local/dev: memoria em processo

Fluxo online:

1. Host cria sala (`action: create`)
2. Guest entra na sala (`action: join`)
3. Guest envia comandos/input (`action: command` e `action: input`)
4. Host simula partida e envia snapshots (`action: state`)
5. Guest faz polling em `/api/rooms` e renderiza snapshot

## Estrutura de assets

O jogo tenta carregar sprites a partir de `AssetsGame`:

```text
AssetsGame/
  Fighter/
    idle.png
    walk.png
    jump.png
    attack1.png
    attack2.png
    hurt.png
    ko.png
  Samurai/
    ...
  Shinobi/
    ...
```

Cada imagem deve ser spritesheet horizontal com a animacao da acao.

## Executar localmente

Pre-requisitos:

- Node.js 20+

Passos:

1. `npm install`
2. `vercel dev`
3. Abrir a URL mostrada no terminal

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

Faça o deploy normal do projeto.

## Endpoints backend

Rota unica: `GET/POST /api/rooms`

Acoes `POST`:

- `create`
- `join`
- `input`
- `command`
- `state`
- `match-start`
- `match-end`
- `close`

Consulta `GET`:

- `?roomId=...&role=host&since=...`
- `?roomId=...&role=guest`

## Observacoes importantes

- Multiplayer exige `http://` ou `https://` (nao funciona em `file://`)
- O host e autoridade da simulacao
- Guest envia somente input/comandos; estado final vem do snapshot do host
- Salas expiram automaticamente por TTL no backend


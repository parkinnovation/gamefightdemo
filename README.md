# Game Fight Demo

Jogo de luta 1x1 em estilo Street Fight com:

- selecao de personagem
- luta jogador vs CPU
- barra de energia
- rounds (melhor de 3)

## Estrutura de assets

Coloque os assets nestas pastas. O jogo tenta automaticamente `assets/`, `ASSETSGAME/` e `AssetsGame/`:

```text
ASSETSGAME/
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

Cada imagem deve ser um spritesheet horizontal com a animacao completa da acao.
O jogo corta a imagem em 12 quadros na ordem da esquerda para a direita.

Se algum sprite nao existir, o jogo usa fallback visual automaticamente.

## Como executar

Abra `index.html` no navegador.

Controles:

- `A/D`: mover
- `W`: pular
- `J`: ataque 1
- `K`: ataque 2

## Multiplayer online

O modo online nao usa backend proprio. A troca de mensagens entre os dois jogadores acontece no navegador, usando `BroadcastChannel` e, quando necessario, um fallback via `localStorage`.

Para funcionar no deploy:

- sirva o jogo por `http://` ou `https://`, nao por `file://`
- abra os dois jogadores na mesma origem exata, incluindo protocolo, dominio e porta
- evite colocar um jogador em um dominio/subdominio diferente do outro

Observacao importante do teste em `https://gamefightdemo.vercel.app/`:

- a sala so sincroniza entre abas/janelas do mesmo navegador e da mesma origem
- se os jogadores estiverem em dispositivos ou navegadores diferentes, a conexao pode ficar em `Conectando na sala...` e expirar depois de um tempo
- quando isso acontece, o jogo agora avisa que essa build nao tem backend/realtime externo

Se a pagina for aberta diretamente do disco ou em origens diferentes, a sala nao sincroniza.

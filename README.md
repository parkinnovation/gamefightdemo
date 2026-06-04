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

Se a pagina for aberta diretamente do disco ou em origens diferentes, a sala nao sincroniza.

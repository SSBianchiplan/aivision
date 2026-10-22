# GPlanSiS|Vídeo — Seguir sujeito / Reenquadrar (, Top 10 #9)

## O que é
Botão **◎ Seguir sujeito** no cabeçalho do editor (e "Seguir sujeito…" no inspetor, seção Clipe). O recorte passa a acompanhar uma pessoa ou objeto e a saída vira **9:16, 1:1, 4:5 ou 16:9**. Isso serve para fazer um vertical (Reels/Shorts) a partir de um vídeo horizontal.

## Fluxo
1. **Escopo.** O clipe selecionado ou, se nenhum estiver selecionado, o que está sob o playhead.
2. **Diálogo.** Opções do diálogo:
   - proporção;
   - sujeito: *Clicar no sujeito* ou *Pessoa principal*;
   - rastreio: *Pessoa (YOLOX + ByteTrack), com aparência para objetos*, *Aparência* ou *SAM 2*;
   - análise: cada quadro, 1 a cada 2 ou 1 a cada 3;
   - zoom: 1×, 1,25×, 1,5× ou 2×. Em 16:9 de um vídeo 16:9, o zoom 1× não dá margem para mover o recorte, e o diálogo avisa;
   - suavidade;
   - zona morta.

   As escolhas ficam salvas em `localStorage['gplansis.video.seguir']`.
3. **Clicar no sujeito.** O visor entra no modo `alvo`: mostra o quadro inteiro e as pessoas que o detector vê, desenhadas em verde. As setas ←/→ trocam de quadro e Esc cancela. O clique dá início à análise.
4. **Análise.** É feita quadro a quadro (os mesmos quadros exatos da exportação, via WebCodecs; sem WebCodecs, um `<video>` oculto). Passa pela fila única do ORT, com barra de progresso e botão Cancelar. A interface não trava: o maior intervalo de rAF medido foi de 24 ms, sem nenhuma long task.
5. **Resultado.** Keyframes no clipe (`c.seg`), uma única entrada no desfazer. O recorte geral passa a ter o tamanho da proporção e a proporção do inspetor é atualizada. Pelo botão "Exportar 1080×1920…" (ou o equivalente da proporção escolhida), o diálogo de exportação já abre com a predefinição selecionada.

## Motores
- **pessoa**: YOLOX (COCO, classe person, Apache-2.0) com o operador `track.bytetrack` do pipeline, usado diretamente.
  - O alvo é a trilha sob o clique ou, em "pessoa principal", a trilha com maior área × centralidade × presença.
  - Trilhas interrompidas são emendadas por posição e tamanho, nos dois sentidos.
  - Centro de enquadramento: x no meio da caixa, y a 45% da altura (deixa espaço para a cabeça).
- **aparência**: ZNCC em tons de cinza a 320 px, com refino subpixel. Rastreia para a frente e para trás a partir do quadro clicado e acompanha mudanças lentas sem perder a referência do clique. É usado automaticamente quando não há pessoa sob o clique.
- **sam2**: dirige o operador `sam2.seguir` quadro a quadro, esperando cada inferência.
  - Só rastreia para a frente a partir do quadro clicado; antes dele, o recorte fica parado no ponto.
  - Se os pesos não carregarem, o rastreio cai para aparência e o resultado traz um aviso.
- **LGPD**: só caixas de pessoa, sem rosto nem identificação, e nada sai do navegador.

## Suavização (seguir.js · `suavizarTrajetoria`)
1. Preenche as lacunas e limita o alvo à região em que o recorte cabe na imagem.
2. Aplica uma mediana de 5.
3. Estende as pontas por reflexão ímpar (como o filtfilt), para não haver transitório nas bordas.
4. Passa um **One Euro** para a frente e para trás (sem atraso).
5. Aplica a **zona morta simétrica**: segura na ida e na volta e tira a média. Com o sujeito parado, o recorte fica imóvel; andando, não fica para trás.
6. Passa a **câmera criticamente amortecida** (ω de 14 a 3 rad/s, conforme a suavidade) com **limite de velocidade** (0,9 largura/s), também ida e volta.
7. Faz o *clamp* final. Os filtros são médias com pesos positivos, então o recorte nunca sai da imagem.

## Modelo de dados (edl.js)
- `c.seg = { k: [[q, cx, cy], ...], motor, prop }`: centro do recorte (normalizado) em quadros da **mídia**.
- O tamanho do recorte é o do recorte geral; a saída continua tendo um tamanho só.
- Entre keyframes: **cúbica de Hermite monótona** (Fritsch–Carlson) sobre o pts real. Não há quina de velocidade e não há overshoot.
- `enquadramento()` dá prioridade a seg, depois kb, depois recorte. Por isso o visor, a exportação MP4 exata, o caminho em tempo real e a exportação de quadros JPEG respeitam o recorte animado sem nenhum código extra.
- Cortar, aparar e mover o clipe preservam o recorte animado: os keyframes ficam na mídia.
- Funções novas: `retSeguir`, `centroSeguir`, `hermiteMonotona`, `moverKeyframe`, `apagarKeyframe`, `porKeyframe`, `keyframesVisiveis`.
- `clipesValidos` valida `seg`.
- A trajetória densa vira keyframes por inserção gulosa até o erro ficar ≤ 0,4%. Um clipe de 8 s fica com cerca de 20 keyframes.

## Edição dos keyframes
- **Timeline**: os keyframes aparecem como losangos amarelos na base da faixa V1, e o rótulo do clipe mostra "· SEGUIR".
  - Clique: seleciona e leva o playhead ao keyframe.
  - Arrastar: move no tempo, sem cruzar os vizinhos.
  - ⌥/Alt+clique ou Delete: apaga.
- **Inspetor**:
  - número de keyframes e posição do selecionado;
  - **Ajustar aqui**: um clique no visor centra o recorte no quadro atual, criando o keyframe ou substituindo o desse quadro;
  - **Apagar keyframe**;
  - **Remover** (o reenquadramento do clipe).
- O desfazer cobre tudo e limpa a seleção de keyframe.

## Exportação
- Novo campo Tamanho com as predefinições **1080×1920**, 1080×1350, 1080×1080 e 1920×1080.
- Só aparecem as que batem com a proporção do recorte (±1,5%), para não distorcer.
- `tamanhoSaida(v, recorte, {w,h})` aceita tamanho fixo e faz upscale quando necessário.

## Rotação (vídeo de celular em pé) — limitação corrigida
- Antes, a exportação exata usava os quadros deitados do VideoDecoder, enquanto o visor mostrava o vídeo de pé.
- Agora, ao abrir, o `StudioVideo` troca largura e altura quando `rotacao` é 90 ou 270 (as dimensões codificadas ficam em `larguraCod`/`alturaCod` para o decodificador).
- `exportar.js` gira cada quadro (`fonteExibida`) antes de recortar, e a análise também gira.
- Teste: exportação de um MP4 com display matrix de 90° contra o quadro do `<video>` deu diferença média de 1,06 por canal; o controle girado 180° deu 33.
- As miniaturas de vídeo girado continuam pelo `<video>` oculto, como antes.
- Os índices WebM/MKV não leem rotação, o que já era assim.

## Atalhos e gancho de teste
- Esc sai do modo alvo; Delete apaga o keyframe selecionado.
- `window.aivVideo` ganhou:
  - `seguir(op)`, `alvo(nx, ny)`, `selecionarKf`, `apagarKf`, `reposicionarKf`, `removerSeguir`, `cancelarSeguir`;
  - `resultados().seguir`, com amostras, keyframes e trajetória.

# Telemetria

O widget **Telemetria** e o **rodapé de monitoramento** mostram, ao vivo, onde o tempo de cada quadro está sendo gasto. Servem para testar o desempenho em qualquer aparelho sem abrir as ferramentas de desenvolvedor.

## Rodapé

Uma linha fina no pé da tela (ligada por padrão no computador; no celular, marque "também no celular"). Valores fora da faixa saudável ficam em amarelo ou vermelho. Clicar numa métrica abre o widget.

## Métricas

| Métrica | O que mostra |
|---|---|
| fps do laço | quadros processados por segundo |
| captura | fps real da fonte (`requestVideoFrameCallback`) e resolução |
| pulados/perdidos | quadros que a fonte entregou e o laço não processou |
| qualidade do YouTube | nível informado pelo player |
| modo de exibição | passthrough, overlay ou pixels, e qual operador força pixels |
| canvas de exibição | tamanho do canvas, densidade efetiva e se o teto de área agiu |
| largura de trabalho | `procWidth`, com "↓auto" quando a qualidade automática baixou |
| tempo do quadro | média e p95 |
| inferência por modelo | tempo e backend (GPU, WASM ou GPU→WASM depois de uma falha) |
| fila do worker | pedidos esperando inferência |
| atraso da sincronia | quanto a imagem está atrasada em arquivo/YouTube |
| repetidos/saltados | fluidez da imagem exibida |
| economia de CPU | descanso da fila WASM ligado ou não |
| memória e travadas | heap JS e long tasks por segundo |
| threads | isolamento de origem e núcleos |

Cada métrica liga ou desliga no widget; as escolhas ficam no aparelho. Com o rodapé e o widget fechados, nada é medido (custo zero).

## Relatório

- **Copiar relatório:** texto com navegador, placa de vídeo (WebGPU e WebGL), todas as métricas, configurações da captura, tamanhos de canvas e tela, nós do pipeline e o estado de cada modelo. Se a área de transferência for recusada, baixa um `.txt`.
- **Gravar 30 s:** série temporal das métricas em CSV.

Código: `site/js/cv/runtime/telemetria.js` (coletor) e `site/js/components/RodapeTelemetria.js` (rodapé).

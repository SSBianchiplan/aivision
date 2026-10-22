# Documentação do iaVision

| Documento | Conteúdo |
|---|---|
| [arquitetura.md](arquitetura.md) | como o sistema é montado: página, núcleo de visão, regras do runtime, serviços |
| [interface.md](interface.md) | barra, painéis, barra de vídeo, atalhos, celular |
| [fontes.md](fontes.md) | câmera, arquivo, tela, RTMP, **YouTube** (captura, quadros, controles e teclas de mídia) |
| [modulos.md](modulos.md) | catálogo gerado do código: 40 módulos, 80 operadores com parâmetros, 38 modelos com licença |
| [industrial.md](industrial.md) | módulo Industrial: BeltScan (volumetria de correia), CounterVision (contagem em esteira), Takt (tempo de posto), Inspect (inspeção OK/NOK) |
| [esportes.md](esportes.md) | hub Esportes, Studio Bike Fit (perfil do atleta e alvos), Corrida com várias pessoas, VBT sem marcador |
| [bike-fit.md](bike-fit.md) | Bike Fit: como filmar, medidas, faixas por perfil, ciclo, validação |
| [bike-fit-3d.md](bike-fit-3d.md) | Bike Fit 3D: especificação de câmeras (celular, câmeras comuns, ToF) e protótipo |
| [video.md](video.md) | editor de vídeo GPlanSiS\|Vídeo: quadro exato, timeline, cortes, recorte/Ken Burns, exportação MP4 (WebCodecs), quadros para o +Projeto |
| [via.md](via.md) | assistente de IA Via: chave Anthropic do usuário, ferramentas, biblioteca de comandos, anexos, base de conhecimento (RAG) |
| [desempenho.md](desempenho.md) | WebGPU por modelo, fila com prioridade, abertura sob demanda, cache, medições |
| [treinar.md](treinar.md) | Treinar: RF-DETR, PatchCore, YOLO26, fila, comparação, formato publicado |
| [servicos.md](servicos.md) | Caddy, login, aivision-treino (com SSO de admin), aivision-yt, aivision-via (PostgreSQL), pacote AGPL |
| [compatibilidade.md](compatibilidade.md) | o que funciona em cada navegador (Chrome/Edge, Safari 15 e 26, Firefox, celular), limitações e contornos |
| [deploy-e-testes.md](deploy-e-testes.md) | rodar localmente (`ferramentas/servir.py`, `ferramentas/baixar-wasm.sh`), testes no navegador, publicar |
| [licencas.md](licencas.md) | licença do código e de cada modelo/biblioteca |
| [roadmap.md](roadmap.md) | ideias abertas para contribuição, com esforço e as boas para começar |

Histórico de versões: [../CHANGELOG.md](../CHANGELOG.md). Como contribuir: [../CONTRIBUTING.md](../CONTRIBUTING.md).

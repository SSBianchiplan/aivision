# Licenças

O código do iaVision é distribuído sob **AGPL-3.0** (`LICENSE`), porque os modelos Ultralytics (YOLO26, YOLOE e detectores treinados com YOLO26) são AGPL-3.0 e o sistema fica exposto na rede. Esses modelos ficam **desligados por padrão** e só carregam após aceite explícito (Modelos › AGPL, ou Config › Modelos livres › "Usar só modelos livres" para desligar). O código-fonte correspondente à versão em produção fica em `/codigo-fonte/`.

Os demais modelos têm licença própria, registrada em cada spec (campo `license`) e listada em [modulos.md](modulos.md):

| Licença | Modelos |
|---|---|
| Apache-2.0 | YOLOX, PP-HumanSeg, PP-OCR (v3 e v5 latino), MobileSAM, SAM 2.1, Depth Anything V2 small, RF-DETR, RTMO (pesos; o conjunto Body7 agrega datasets acadêmicos), re-ID Youtu (OpenCV Zoo), MediaPipe (palma, mão, malha do rosto), PatchCore (implementação própria), RelateAnything (código; pesos derivados de DINOv3 — licença Meta) |
| MIT | Florence-2, BiRefNet |
| BSD-3-Clause | ResNet-18 do torchvision (base do PatchCore) |
| Apple ML | MobileCLIP / MobileCLIP2 |
| AGPL-3.0 | YOLO26 (8 tarefas), YOLOE, treinados YOLO26 |

Bibliotecas no navegador: React e ReactDOM (MIT), htm (Apache-2.0), ONNX Runtime Web (MIT), transformers.js (Apache-2.0), ZXing (Apache-2.0), hls.js (Apache-2.0). SDK oficial da Anthropic `@anthropic-ai/sdk` **0.137.0** (MIT), usado pela Via ([via.md](via.md)): bundle ESM de arquivo único gerado pelo esm.sh a partir do pacote do npm, em `vendor/anthropic/sdk-0.137.0.mjs` (sha256 do arquivo vendorizado `e3282b7e…82f1d2ca`; só a linha do sourcemap foi tirada); o bundle embute polyfills do unenv (MIT), `buffer` (MIT) e `ieee754` (BSD-3-Clause). Muxer MP4 do editor de vídeo ([video.md](video.md)): `mp4-muxer` **5.2.2** (MIT, © 2023 Vanilagy), o arquivo ESM `build/mp4-muxer.mjs` do pacote do npm copiado sem alteração para `vendor/mp4-muxer-5.2.2.mjs` (sha256 `d2c4c782…d38f9bb5`). Serviços: FastAPI (MIT), yt-dlp (Unlicense), Ultralytics (AGPL-3.0), rfdetr (Apache-2.0), PyTorch (BSD).

O protótipo é de uso não comercial; antes de uso comercial, revise as licenças marcadas acima (em especial AGPL, Apple ML, DINOv3 e os datasets de treino).

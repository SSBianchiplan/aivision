/**
 * Operadores livres — grupo N: INSPEÇÃO VISUAL (CV-40), o porte do
 * GPlanSiS|Inspect para o hub Industrial. Parte 1: visão clássica em JS puro
 * sobre ImageData. Parte 2: OCR de lote/validade, código com verificação,
 * serial, detector, classificação conformal e anomalia PatchCore, como novas
 * ferramentas em runtime/livres-n/ferramentas.js — REUSANDO modelos que o
 * iaVision já tem (PP-OCRv5 do CV-17, ZXing do CV-10, YOLOX, RF-DETR,
 * MobileNetV2, os treinados do CV-24); por isso models-livres-n.js segue vazio.
 */
import inspect from './livres-n/inspect.js';

export const MODULES_N = [
  {
    id: 'CV-40',
    name: 'Inspeção visual (Inspect)',
    status: 'ready',
    runtime: 'client',
    desc: 'Inspeção de qualidade pela câmera, no navegador (porte do GPlanSiS|Inspect): presença por molde (NCC), ' +
          'contagem de manchas/furos (Otsu, adaptativo), paquímetro em mm com sub-pixel, cor por ΔE2000, forma ' +
          '(Ø equivalente, circularidade, solidez, alongamento), área de defeito por HSV, OCR de lote e validade (PP-OCRv5, ' +
          '{LOT}/{TODAY}, validade mínima), códigos QR/DataMatrix/EAN com GS1 e GTIN, número de série com sequência, ' +
          'detector (YOLOX/RF-DETR/treinado), classificação conformal e anomalia PatchCore com mapa de calor, cada uma lendo a ROI das ' +
          'marcações "Inspect · …". Programa (receita) versionado com gatilho de presença, linha, intervalo ou manual, ' +
          'alinhamento à peça de referência, veredito OK / NOK / INCERTO, histórico, fila de revisão humana, CSV, ' +
          'alarmes de sequência e Cpk. Tela cheia GPlanSiS|Inspect.',
  },
];

export default [...inspect];

#!/usr/bin/env bash
# Baixa os binários .wasm do ONNX Runtime Web, que ficam fora do git por tamanho.
# As versões são as mesmas dos .js vendorizados:
#   site/vendor/ort/           → onnxruntime-web 1.20.1 (sistema)
#   site/relacoes/vendor/ort/  → onnxruntime-web 1.29.0 (página Relações)
# Uso: ferramentas/baixar-wasm.sh   (da raiz do repositório ou de qualquer lugar)
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

baixar() {   # versão  pasta-destino  arquivo...
  local versao="$1" destino="$2"; shift 2
  mkdir -p "$destino"
  for arq in "$@"; do
    local url="https://cdn.jsdelivr.net/npm/onnxruntime-web@${versao}/dist/${arq}"
    if [ -s "$destino/$arq" ]; then
      echo "ok (já existe)  $destino/$arq"; continue
    fi
    echo "baixando        $url"
    curl -fL --retry 3 -o "$destino/$arq.parcial" "$url"
    mv "$destino/$arq.parcial" "$destino/$arq"
  done
}

# Sistema: ort.min.js usa a wasm comum; ort.webgpu.min.js usa a JSEP (WebGPU + WASM).
baixar 1.20.1 "$RAIZ/site/vendor/ort" \
  ort-wasm-simd-threaded.wasm \
  ort-wasm-simd-threaded.jsep.wasm

# Página Relações (worker com ort.min.js 1.29.0).
baixar 1.29.0 "$RAIZ/site/relacoes/vendor/ort" \
  ort-wasm-simd-threaded.jsep.wasm

# Confere que o .mjs vendorizado tem a mesma versão do .wasm baixado
# (o loader e o binário precisam casar; versão misturada falha ao instanciar).
grep -q '1\.20\.1' "$RAIZ/site/vendor/ort/ort.min.js" \
  || { echo "ERRO: site/vendor/ort/ort.min.js não é 1.20.1"; exit 1; }
grep -q '1\.29\.0' "$RAIZ/site/relacoes/vendor/ort/ort.min.js" \
  || { echo "ERRO: site/relacoes/vendor/ort/ort.min.js não é 1.29.0"; exit 1; }

ls -lh "$RAIZ/site/vendor/ort/"*.wasm "$RAIZ/site/relacoes/vendor/ort/"*.wasm
echo "pronto."

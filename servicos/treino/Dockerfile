# GPlanSiS|iaVision · serviço de treino (CPU).
# Licenças: RF-DETR (rfdetr, Apache-2.0; pesos nano/small/medium/base Apache-2.0) e PatchCore (implementação
# própria, torchvision BSD-3-Clause) são livres. Ultralytics YOLO26 é AGPL-3.0, mantido só para compatibilidade:
# o código-fonte do serviço e do site é publicado em https://aivision.gplansis.com/codigo-fonte/.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 OMP_NUM_THREADS=3 YOLO_CONFIG_DIR=/data/.ultralytics \
    TORCH_HOME=/data/pesos/torch HF_HOME=/data/pesos/hf
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install ultralytics "rfdetr[train,onnx]==1.11.2" onnx onnxslim onnxruntime fastapi "uvicorn[standard]" \
      python-multipart pillow \
 && pip uninstall -y opencv-python && pip install --force-reinstall opencv-python-headless
WORKDIR /app
COPY app.py job.py comum.py treino_rfdetr.py treino_patchcore.py ./
EXPOSE 8996
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8996", "--proxy-headers"]

# Conectores de servidor do Motion 3D Studio (GVHMR, ExMR, FlowHMR) do iaVision.
# A imagem NÃO traz motor, peso nem modelo de corpo: sem instalação separada, tudo responde 501.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd -r -u 10001 -d /app aiv \
 && mkdir -p /dados && chown aiv /dados && chmod 700 /dados
COPY app.py motores.py ./
USER aiv
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--limit-concurrency", "64"]

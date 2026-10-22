# Serviço de busca do YouTube do iaVision (só metadados; nunca baixa mídia).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
# yt-dlp sem versão fixa de propósito: o YouTube muda e a busca quebra com versões velhas.
# Se a busca parar, reconstrua com --no-cache (ver LEIA-ME.md).
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd -r -u 10001 -d /app aiv
COPY app.py .
USER aiv
EXPOSE 8995
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8995", "--proxy-headers", "--forwarded-allow-ips", "*"]

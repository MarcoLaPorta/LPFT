# Build e run LPFT Worker (RQ)
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY lpft_worker/ ./lpft_worker/

RUN pip install --no-cache-dir -e .

ENV LPFT_STORAGE_DIR=/storage

CMD ["python", "-m", "lpft_worker.worker"]

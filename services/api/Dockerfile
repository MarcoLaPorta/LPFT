# Build e run LPFT API
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY lpft_api/ ./lpft_api/

RUN pip install --no-cache-dir -e .

ENV LPFT_STORAGE_DIR=/storage
EXPOSE 8000

CMD ["uvicorn", "lpft_api.main:app", "--host", "0.0.0.0", "--port", "8000"]

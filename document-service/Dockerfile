FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py pdf_engine.py highlight.py server.py ./
RUN useradd --create-home --uid 10001 fitify
USER fitify
ENV HOST=0.0.0.0 PORT=8091
EXPOSE 8091
CMD ["python","server.py"]

FROM node:18-bullseye

# System deps: Python + ffmpeg for audio and faster-whisper
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=120

WORKDIR /app

# Install Node deps first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app code
COPY . .

# Python deps (faster-whisper is CPU-friendly and light)
RUN python3 -m pip install --upgrade pip setuptools wheel && \
    python3 -m pip install "faster-whisper==1.0.3"

# Express reads PORT from env; set python exec for Node->Python spawn
ENV PYTHON_EXEC=python3

CMD ["node", "index.js"]

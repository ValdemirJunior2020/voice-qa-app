FROM node:18-bullseye
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN pip3 install --no-cache-dir openai-whisper==20231117
ENV PYTHON_EXEC=python3
CMD ["node", "index.js"]

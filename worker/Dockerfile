FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY worker ./worker
ENV PORT=8787
ENV FFMPEG_PATH=/usr/bin/ffmpeg
EXPOSE 8787
CMD ["node", "worker/index.mjs"]

FROM node:22.14.0-bookworm-slim
WORKDIR /video
ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/video/.home
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci && npm exec -- hyperframes browser ensure && npm test
CMD ["npm", "run", "render", "--", "--workers", "2"]

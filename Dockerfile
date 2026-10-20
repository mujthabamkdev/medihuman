FROM node:22.11.0-alpine3.20

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV PUBLIC_ROOT=public

COPY package.json package-lock.json ./
RUN npm ci --offline --omit=dev --no-audit --no-fund
COPY server.js index.html styles.css service-worker.js manifest.json manifest.webmanifest vercel.json ./
COPY api ./api
COPY styles ./styles
COPY src ./src
COPY scripts ./scripts
COPY fonts ./fonts
COPY supabase/migrations ./supabase/migrations
COPY test ./test
RUN npm test && npm run build

EXPOSE 4173
CMD ["npm", "start"]

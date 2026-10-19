FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js index.html styles.css ./
COPY styles ./styles
COPY src ./src

EXPOSE 4173
CMD ["npm", "start"]

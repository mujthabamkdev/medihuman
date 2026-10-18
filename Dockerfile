FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173

COPY package.json ./
COPY server.js index.html styles.css ./
COPY src ./src

EXPOSE 4173
CMD ["npm", "start"]

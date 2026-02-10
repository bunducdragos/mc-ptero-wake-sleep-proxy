FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY server.js ./

COPY server-icon.png ./

EXPOSE 25565

CMD ["node", "server.js"]

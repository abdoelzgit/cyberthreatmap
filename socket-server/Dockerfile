FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY socket-server.js ./

EXPOSE 4000

CMD ["npm", "start"]

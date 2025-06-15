FROM node:20

WORKDIR /signaling

COPY package*.json ./
COPY server.js .
RUN npm install

COPY . .

CMD ["node", "server.js"]
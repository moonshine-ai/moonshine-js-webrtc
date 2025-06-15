FROM node:20

WORKDIR /signaling

COPY package*.json ./
COPY index.html .
COPY vite.config.js .
COPY app.js .
RUN npm install

COPY . .

CMD ["node", "server.js"]
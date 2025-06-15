FROM node:20

WORKDIR /signaling 

COPY matchmaker/package*.json ./
COPY matchmaker/server.js .
RUN npm install

COPY . .

CMD ["node", "matchmaker/server.js"]
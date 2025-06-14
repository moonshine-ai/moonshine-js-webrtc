FROM node:20

WORKDIR /signaling

COPY package*.json ./
COPY index.html .
COPY vite.config.js .
COPY .wellknown .
RUN npm install

COPY . .

#EXPOSE 8080

#CMD ["npm", "run", "start"]

CMD ["npx", "vite"]
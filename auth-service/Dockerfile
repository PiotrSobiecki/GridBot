FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Używamy npm install zamiast npm ci, bo lock file może nie być zsynchronizowany
RUN npm install --omit=dev --prefer-offline --no-audit

COPY . .

EXPOSE 3001

CMD ["npm", "start"]

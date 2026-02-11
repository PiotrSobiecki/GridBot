# Dockerfile dla Railway - buduje auth-service z głównego katalogu
FROM node:20-alpine

WORKDIR /app

# Kopiuj package.json i package-lock.json z auth-service
COPY auth-service/package*.json ./

# Zainstaluj zależności (używamy npm install zamiast npm ci, bo lock file może nie być zsynchronizowany)
RUN npm install --omit=dev --prefer-offline --no-audit

# Kopiuj cały katalog auth-service
COPY auth-service/ .

EXPOSE 3001

CMD ["npm", "start"]

# Dockerfile dla Railway - buduje auth-service z głównego katalogu
FROM node:20-alpine

WORKDIR /app

# Kopiuj package.json z auth-service
COPY auth-service/package*.json ./

# Zainstaluj zależności
RUN npm ci --only=production

# Kopiuj cały katalog auth-service
COPY auth-service/ .

EXPOSE 3001

CMD ["npm", "start"]

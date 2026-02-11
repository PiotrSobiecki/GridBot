# Dockerfile dla Railway - buduje frontend i auth-service razem
FROM node:20-alpine AS frontend-builder

# Buduj frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --prefer-offline --no-audit
COPY frontend/ .
RUN npm run build

# Finalny obraz z backendem i zbudowanym frontendem
FROM node:20-alpine

WORKDIR /app

# Kopiuj package.json i package-lock.json z auth-service
COPY auth-service/package*.json ./

# Zainstaluj zależności backendu (używamy npm install zamiast npm ci, bo lock file może nie być zsynchronizowany)
RUN npm install --omit=dev --prefer-offline --no-audit

# Kopiuj cały katalog auth-service
COPY auth-service/ .

# Kopiuj zbudowany frontend z poprzedniego stage
COPY --from=frontend-builder /frontend/dist ./frontend/dist

EXPOSE 3001

CMD ["npm", "start"]

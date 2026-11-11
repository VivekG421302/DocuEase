FROM node:20-slim

# LibreOffice Writer (docx -> pdf) + fonts so PDFs render properly
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-liberation \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]

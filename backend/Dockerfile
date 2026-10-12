FROM node:20-alpine

WORKDIR /app

# Copia dependências e instala o Express
COPY package*.json ./
RUN npm install

# Copia o código da aplicação
COPY . .

# Expõe a porta interna 5000
EXPOSE 5000

# Executa o servidor Node com Express
CMD ["npm", "start"]

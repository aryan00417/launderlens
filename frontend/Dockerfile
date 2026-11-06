FROM node:20-slim
WORKDIR /srv
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]

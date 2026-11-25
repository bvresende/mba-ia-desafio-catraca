FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]

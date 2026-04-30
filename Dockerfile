FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# 의존성 레이어를 먼저 만들어 빌드 캐시를 최대한 재사용한다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
RUN chown -R node:node /app && chmod -R a+rX /app

USER node

CMD ["node", "src/app.js"]

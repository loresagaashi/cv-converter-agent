# Production image — ACR build context must be ./frontend
FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

ARG NEXT_PUBLIC_API_BASE_URL_LOCAL=
ENV NEXT_PUBLIC_API_BASE_URL_LOCAL=${NEXT_PUBLIC_API_BASE_URL_LOCAL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]

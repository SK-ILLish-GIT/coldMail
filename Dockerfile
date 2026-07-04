# coldMail — production image (single-origin: Express serves client/dist + /api)
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/

RUN npm install \
 && npm --prefix server install \
 && npm --prefix client install

COPY client ./client
COPY server ./server

RUN npm --prefix server install \
 && npm --prefix client install --include=dev \
 && npm --prefix client run build

# --- Runtime ---
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/

# Production deps only (root has no runtime deps; server has all API deps).
RUN npm --prefix server install --omit=dev

COPY --from=build /app/server/src ./server/src
COPY --from=build /app/client/dist ./client/dist

# Resume tailor reads CV_DEFAULT_PATH (default ./Sk_Sahil_Parvez_CV_ at repo root).
COPY Sk_Sahil_Parvez_CV_ ./Sk_Sahil_Parvez_CV_

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["npm", "start"]

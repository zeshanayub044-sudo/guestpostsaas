FROM node:24-bookworm-slim
WORKDIR /app/browser-worker
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
COPY browser-worker/package*.json ./
RUN npm ci --ignore-scripts && npx playwright install --with-deps chromium && chmod -R a+rX /opt/playwright-browsers && useradd --create-home --uid 1001 publisher
COPY browser-worker/src ./src
COPY supabase/functions/_shared/browser-contract.mjs /app/supabase/functions/_shared/browser-contract.mjs
USER publisher
ENV NODE_ENV=production
CMD ["node","src/index.mjs"]

# PairUp agent for Amazon Bedrock AgentCore Runtime (ARM64, port 8080:
# POST /invocations, GET /ping). Build and deploy with ./deploy.sh.
FROM --platform=linux/arm64 node:22-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

USER node
EXPOSE 8080
CMD ["npx", "tsx", "src/main.ts"]

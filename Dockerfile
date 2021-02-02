FROM node:12-buster-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    python \
    && rm -fr /var/lib/apt/lists/*

RUN mkdir -p /home/node/app && chown node:node /home/node/app
USER node
WORKDIR /home/node/app

# This can't be split easily because of prepublish step.
COPY --chown=node:node . ./
RUN yarn install --pure-lockfile && yarn prepare

# Spec 022 (research R4): the browser-test stack's address stand-in. Node only, no dependencies.
FROM node:22-alpine
WORKDIR /stub
COPY server.mjs addresses.json ./
EXPOSE 8081
CMD ["node", "server.mjs"]

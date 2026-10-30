# syntax=docker/dockerfile:1
# Keycloak with the QueuePass sign-in look (spec 021, research R6).
#
# Build context: the repository root (docker-compose.yml), because the sign-in look takes its
# colors, fonts, and controls from the one shared theme, packages/shared/src/web/theme.css. It is
# copied in at build time, so the repository holds one copy of it (research R4).
FROM quay.io/keycloak/keycloak:26.0

COPY keycloak/themes/queuepass /opt/keycloak/themes/queuepass
COPY packages/shared/src/web/theme.css /opt/keycloak/themes/queuepass/login/resources/css/theme.css

# Contracts: A Separate Sign-in for Each App

**Text only; no operation, schema shape or error code changes.** `contracts/openapi.yaml` goes from
`1.20.0` to `1.21.0` (MINOR: which tokens are accepted changes for every client):

- `info.description`, **Authentication**: tokens are issued by one of the three app realms
  (`queuepass-admin-app`, `queuepass-customer-app`, `queuepass-booth-app`). The Backend checks each
  against its own realm's keys and issuer (`http://localhost:8080/realms/<realm>`), that its
  audience includes `queuepass-api`, and that it is not expired. A token from any other issuer,
  the retired realm `queuepass` included, is `401 UNAUTHENTICATED`.
- `info.description`, **Authorization**: roles are read from `realm_access.roles`, and from each
  realm only its app's role counts (`queuepass-admin` from the Admin app's realm, `customer` from the
  Customer app's, `gate-agent` from the Ticket Booth's). Any other role in the token is ignored.
- `components.securitySchemes.bearerAuth.description`: a Keycloak access token from one of the three
  app realms.
- `components.schemas.Me.properties.roles.description`: the caller's QueuePass role, the one its
  realm grants; other roles are omitted.

`packages/shared/src/api-schema.ts` is regenerated (`npm run generate:api`); only the `Me.roles`
comment changes.

The interface that really changes is configuration, specified in [data-model.md](../data-model.md):
the Backend's `OIDC_ISSUER_BASE` and `OIDC_JWKS_BASE`, and each app's `VITE_OIDC_AUTHORITY`.

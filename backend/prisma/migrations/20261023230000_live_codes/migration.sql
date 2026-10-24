-- Spec 018 (#41), data-model.md: each ticket's entry secret for its live codes (research R1).
-- gen_random_bytes is volatile, so every existing ticket gets its own secret.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "Ticket" ADD COLUMN "entrySecret" BYTEA NOT NULL DEFAULT gen_random_bytes(32);

ALTER TABLE "Ticket" ADD CONSTRAINT ticket_entry_secret_32_bytes CHECK (octet_length("entrySecret") = 32);

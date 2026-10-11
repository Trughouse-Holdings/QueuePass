-- Spec 016 FR-001, FR-017 (research R1): an optional per-customer ticket limit. No default and
-- no backfill, so every existing event has no limit. The CHECK keeps a limit from 1 to the
-- event's capacity on every write path; the Backend refuses out-of-range values first, with a
-- message (research R6).
ALTER TABLE "Event" ADD COLUMN "maxTicketsPerCustomer" INTEGER;
ALTER TABLE "Event" ADD CONSTRAINT "event_max_tickets_per_customer_range"
  CHECK ("maxTicketsPerCustomer" IS NULL
         OR "maxTicketsPerCustomer" BETWEEN 1 AND "totalTicketCapacity");

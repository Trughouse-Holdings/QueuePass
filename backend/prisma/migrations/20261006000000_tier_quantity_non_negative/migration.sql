-- Spec 007 FR-006 (research R11): a seated tier's quantity is the seats in its mapped sections,
-- so a tier with no section has 0. Typed quantities (general admission) are still validated as
-- at least 1 by the Backend.
ALTER TABLE "TicketTier" DROP CONSTRAINT "ticket_tier_quantity_positive";
ALTER TABLE "TicketTier"
    ADD CONSTRAINT "ticket_tier_quantity_non_negative" CHECK ("quantity" >= 0);

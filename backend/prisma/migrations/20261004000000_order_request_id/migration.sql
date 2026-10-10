-- Spec 006: one confirmation, one order (FR-005), and a customer's own orders (FR-007).

-- AlterTable: the client's id for one confirmation. Existing orders keep NULL.
ALTER TABLE "Order" ADD COLUMN "requestId" UUID;

-- CreateIndex: a repeated confirmation cannot become a second order, even across events
-- (research R3). PostgreSQL treats NULLs as distinct, so orders without a requestId never
-- collide.
CREATE UNIQUE INDEX "Order_customerSub_requestId_key" ON "Order"("customerSub", "requestId");

-- CreateIndex: My tickets reads one customer's orders, newest first (research R4).
CREATE INDEX "Order_customerSub_createdAt_idx" ON "Order"("customerSub", "createdAt");

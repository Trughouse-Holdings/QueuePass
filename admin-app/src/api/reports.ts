import type { SalesReport } from '@queuepass/shared';
import { api, unwrap } from './client';

/** Spec 005 FR-005: totals and per-event, per-tier sales, computed on request. */
export const getSalesReport = (): Promise<SalesReport> => unwrap(api.GET('/reports/sales'));

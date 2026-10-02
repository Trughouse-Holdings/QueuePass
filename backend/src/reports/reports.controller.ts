import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { ReportsService, SalesReportResponse } from './reports.service';

/** Implements getSalesReport in contracts/openapi.yaml (spec 005). */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  @Roles('queuepass-admin')
  sales(): Promise<SalesReportResponse> {
    return this.reports.sales();
  }
}

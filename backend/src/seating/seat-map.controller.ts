import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import type { SeatMap } from '@queuepass/shared';
import { Roles } from '../auth/roles.decorator';
import { SeatingInputDto } from './dto/seating-input.dto';
import { SeatMapService } from './seat-map.service';

/** Implements getSeatMap and updateSeating in contracts/openapi.yaml (spec 007). */
@Controller('events/:id')
export class SeatMapController {
  constructor(private readonly seatMaps: SeatMapService) {}

  /** Any signed-in user: it says which seats are taken, never by whom (FR-013). */
  @Get('seats')
  seats(@Param('id', ParseUUIDPipe) id: string): Promise<SeatMap> {
    return this.seatMaps.forEvent(id);
  }

  @Put('seating')
  @Roles('queuepass-admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SeatingInputDto): Promise<SeatMap> {
    return this.seatMaps.update(id, dto);
  }
}

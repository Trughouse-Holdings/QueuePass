import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Availability } from '@queuepass/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { AvailabilityService } from './availability.service';
import { EventsService, EventResponse } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { ListEventsQuery } from './dto/list-events.query';

/** Implements the /events operations in contracts/openapi.yaml. */
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  findAll(@Query() query: ListEventsQuery): Promise<EventResponse[]> {
    return this.events.findAll(query);
  }

  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateEventDto): Promise<EventResponse> {
    return this.events.create(dto);
  }

  /**
   * Spec 006 FR-002: any signed-in user, like the event it describes. Spec 016: the caller's own
   * standing against the event's limit.
   */
  @Get(':id/availability')
  availabilityOf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() caller: Principal,
  ): Promise<Availability> {
    return this.availability.forEvent(id, caller);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<EventResponse> {
    return this.events.findOne(id);
  }

  @Patch(':id')
  @Roles('queuepass-admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<EventResponse> {
    return this.events.update(id, dto);
  }

  @Post(':id/cancel')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ event: EventResponse; ordersRefunded: number; ticketsVoided: number }> {
    return this.events.cancel(id);
  }

  @Delete(':id')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.events.remove(id);
  }
}

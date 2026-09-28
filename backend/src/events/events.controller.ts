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
import { Roles } from '../auth/roles.decorator';
import { EventsService, EventResponse } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

/** Implements the /events operations in contracts/openapi.yaml. */
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  findAll(@Query('locationId') locationId?: string): Promise<EventResponse[]> {
    return this.events.findAll(locationId);
  }

  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateEventDto): Promise<EventResponse> {
    return this.events.create(dto);
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

  @Delete(':id')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.events.remove(id);
  }
}

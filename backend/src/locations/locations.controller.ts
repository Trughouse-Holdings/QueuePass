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
} from '@nestjs/common';
import type { Location } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

/** Implements the /locations operations in contracts/openapi.yaml. */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  findAll(): Promise<Location[]> {
    return this.locations.findAll();
  }

  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateLocationDto): Promise<Location> {
    return this.locations.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Location> {
    return this.locations.findOne(id);
  }

  @Patch(':id')
  @Roles('queuepass-admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<Location> {
    return this.locations.update(id, dto);
  }

  @Delete(':id')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.locations.remove(id);
  }
}

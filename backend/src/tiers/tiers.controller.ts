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
import { Roles } from '../auth/roles.decorator';
import { CreateTierDto } from './dto/create-tier.dto';
import { UpdateTierDto } from './dto/update-tier.dto';
import { TierResponse, TiersService } from './tiers.service';

/** Implements the /events/{id}/tiers operations in contracts/openapi.yaml (spec 004). */
@Controller('events/:id/tiers')
export class TiersController {
  constructor(private readonly tiers: TiersService) {}

  @Get()
  list(@Param('id', ParseUUIDPipe) eventId: string): Promise<TierResponse[]> {
    return this.tiers.list(eventId);
  }

  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateTierDto,
  ): Promise<TierResponse> {
    return this.tiers.create(eventId, dto);
  }

  @Patch(':tierId')
  @Roles('queuepass-admin')
  update(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('tierId', ParseUUIDPipe) tierId: string,
    @Body() dto: UpdateTierDto,
  ): Promise<TierResponse> {
    return this.tiers.update(eventId, tierId, dto);
  }

  @Delete(':tierId')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('tierId', ParseUUIDPipe) tierId: string,
  ): Promise<void> {
    return this.tiers.remove(eventId, tierId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { SeasonInputDto } from './dto/season-input.dto';
import type { SeasonResponse } from './season-view';
import { SeasonsService, type SeasonCancellation } from './seasons.service';

/**
 * Implements the Season operations of contracts/openapi.yaml that feature 041 serves (research
 * R3): reads for any signed-in caller (customers see Seasons on sale), writes for admins.
 */
@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  list(@CurrentPrincipal() caller: Principal): Promise<SeasonResponse[]> {
    return this.seasons.list(caller);
  }

  @Post()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: SeasonInputDto): Promise<SeasonResponse> {
    return this.seasons.create(dto);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() caller: Principal,
  ): Promise<SeasonResponse> {
    return this.seasons.get(id, caller);
  }

  @Post(':id/publish')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', ParseUUIDPipe) id: string): Promise<SeasonResponse> {
    return this.seasons.publish(id);
  }

  @Put(':id')
  @Roles('queuepass-admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SeasonInputDto,
  ): Promise<SeasonResponse> {
    return this.seasons.update(id, dto);
  }

  @Delete(':id')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.seasons.remove(id);
  }

  @Post(':id/cancel')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<SeasonCancellation> {
    return this.seasons.cancel(id);
  }
}

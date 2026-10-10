import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import type { SeatingLayout } from '@queuepass/shared';
import { Roles } from '../auth/roles.decorator';
import { LayoutInputDto } from './dto/layout-input.dto';
import { LayoutService } from './layout.service';

/** Implements getLayout, replaceLayout, and deleteLayout in contracts/openapi.yaml (spec 007). */
@Controller('locations/:id/layout')
export class LayoutController {
  constructor(private readonly layouts: LayoutService) {}

  /** Any signed-in user: customers need sections to choose seats. */
  @Get()
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SeatingLayout> {
    return this.layouts.get(id);
  }

  @Put()
  @Roles('queuepass-admin')
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LayoutInputDto,
  ): Promise<SeatingLayout> {
    return this.layouts.replace(id, dto);
  }

  @Delete()
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.layouts.remove(id);
  }
}

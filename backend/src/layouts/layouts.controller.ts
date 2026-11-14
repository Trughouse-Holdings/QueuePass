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
import type { LayoutDetail, LayoutSectionSeats, LayoutSummary } from '@queuepass/shared';
import { Roles } from '../auth/roles.decorator';
import {
  LayoutDuplicateDto,
  LayoutImportDto,
  LayoutLinesInputDto,
  LayoutUpdateDto,
} from './dto/layout-input.dto';
import { LayoutsService } from './layouts.service';

/**
 * Spec 038 research R4: the eight layout operations of contracts/openapi.yaml. Reads are open to
 * any signed-in user (FR-008: the map is public); writes need `queuepass-admin`.
 */
@Controller()
export class LayoutsController {
  constructor(private readonly layouts: LayoutsService) {}

  @Get('locations/:id/layouts')
  list(@Param('id', ParseUUIDPipe) id: string): Promise<LayoutSummary[]> {
    return this.layouts.list(id);
  }

  @Post('locations/:id/layouts')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LayoutLinesInputDto,
  ): Promise<LayoutDetail> {
    return this.layouts.createFromLines(id, dto);
  }

  @Post('locations/:id/layouts/import')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  import(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LayoutImportDto,
  ): Promise<LayoutDetail> {
    return this.layouts.importFile(id, dto);
  }

  @Get('layouts/:layoutId')
  get(@Param('layoutId', ParseUUIDPipe) layoutId: string): Promise<LayoutDetail> {
    return this.layouts.get(layoutId);
  }

  @Put('layouts/:layoutId')
  @Roles('queuepass-admin')
  update(
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @Body() dto: LayoutUpdateDto,
  ): Promise<LayoutDetail> {
    return this.layouts.update(layoutId, dto);
  }

  @Delete('layouts/:layoutId')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('layoutId', ParseUUIDPipe) layoutId: string): Promise<void> {
    return this.layouts.remove(layoutId);
  }

  @Get('layouts/:layoutId/sections/:sectionId')
  section(
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<LayoutSectionSeats> {
    return this.layouts.section(layoutId, sectionId);
  }

  @Post('layouts/:layoutId/duplicate')
  @Roles('queuepass-admin')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @Param('layoutId', ParseUUIDPipe) layoutId: string,
    @Body() dto: LayoutDuplicateDto,
  ): Promise<LayoutDetail> {
    return this.layouts.duplicate(layoutId, dto);
  }
}

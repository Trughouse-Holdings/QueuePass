import { Controller } from '@nestjs/common';
import { SeasonsService } from './seasons.service';

/** Implements the Season operations of contracts/openapi.yaml that feature 041 serves. */
@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}
}

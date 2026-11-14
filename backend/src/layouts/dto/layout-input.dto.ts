import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LAYOUT_LIMITS, LEVEL_COLORS, type LevelColor } from '@queuepass/shared';

/**
 * Spec 038 (T015): the layout requests of contracts/openapi.yaml (`LayoutLinesInput`,
 * `LayoutUpdate`, `LayoutDuplicate`, `LayoutImport`). Names are trimmed before they are checked.
 * A layout file is checked as a whole by `layout-file.ts`, not here, so every problem is listed
 * with its place (research R5).
 */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const NAME = `must be 1 to ${LAYOUT_LIMITS.nameMaxLength} characters`;

/** `LayoutLevelLine`: a level's name and color; its rank is its place in the list. */
export class LayoutLevelLineDto {
  @Transform(trim)
  @IsString({ message: 'a level name must be a string' })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `a level name ${NAME}` })
  name!: string;

  @IsIn(LEVEL_COLORS, { message: `a level color must be one of ${LEVEL_COLORS.join(', ')}` })
  color!: LevelColor;
}

/** `LayoutSectionLine`: Name, Rows × Seats per row, Price level (by name). */
export class LayoutSectionLineDto {
  @Transform(trim)
  @IsString({ message: 'a section name must be a string' })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `a section name ${NAME}` })
  name!: string;

  @IsInt({ message: 'rows must be a whole number' })
  @Min(1, { message: 'rows must be at least 1' })
  @Max(LAYOUT_LIMITS.maxRows, { message: `rows must be at most ${LAYOUT_LIMITS.maxRows}` })
  rows!: number;

  @IsInt({ message: 'seatsPerRow must be a whole number' })
  @Min(1, { message: 'seatsPerRow must be at least 1' })
  @Max(LAYOUT_LIMITS.maxSeatsPerRow, {
    message: `seatsPerRow must be at most ${LAYOUT_LIMITS.maxSeatsPerRow}`,
  })
  seatsPerRow!: number;

  @Transform(trim)
  @IsString({ message: "a section's level must be a level's name" })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `a section's level ${NAME}` })
  level!: string;
}

const levelsOf = (max: number) => [
  IsArray({ message: 'levels must be a list' }),
  ArrayMinSize(1, { message: 'a layout needs at least 1 level' }),
  ArrayMaxSize(max, { message: `a layout has at most ${LAYOUT_LIMITS.maxLevels} levels` }),
  ValidateNested({ each: true }),
  Type(() => LayoutLevelLineDto),
];
const sectionsList = () => [
  IsArray({ message: 'sections must be a list' }),
  ArrayMinSize(1, { message: 'a layout needs at least 1 section' }),
  ArrayMaxSize(LAYOUT_LIMITS.maxSections, {
    message: `a layout has at most ${LAYOUT_LIMITS.maxSections} sections`,
  }),
  ValidateNested({ each: true }),
  Type(() => LayoutSectionLineDto),
];
const apply =
  (decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) => {
    for (const d of decorators) d(target, key);
  };

/** `LayoutLinesInput` (`createVenueLayout`). */
export class LayoutLinesInputDto {
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `name ${NAME}` })
  name!: string;

  @apply(levelsOf(LAYOUT_LIMITS.maxLevels))
  levels!: LayoutLevelLineDto[];

  @apply(sectionsList())
  sections!: LayoutSectionLineDto[];
}

/**
 * `LayoutUpdate` (`updateVenueLayout`): `name` renames; `levels` and `sections` together replace a
 * LINES layout's lines. Up to 50 levels here: a carried-over layout may keep as many as it has,
 * which only the service knows (research R6).
 */
export class LayoutUpdateDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `name ${NAME}` })
  name?: string;

  @ValidateIf((o: LayoutUpdateDto) => o.levels !== undefined)
  @apply(levelsOf(LAYOUT_LIMITS.maxCarriedLevels))
  levels?: LayoutLevelLineDto[];

  @ValidateIf((o: LayoutUpdateDto) => o.sections !== undefined)
  @apply(sectionsList())
  sections?: LayoutSectionLineDto[];
}

/** `LayoutDuplicate`: an optional name for the copy. */
export class LayoutDuplicateDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `name ${NAME}` })
  name?: string;
}

/** `LayoutImport`: the file is any JSON object here; `layout-file.ts` checks it. */
export class LayoutImportDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, LAYOUT_LIMITS.nameMaxLength, { message: `name ${NAME}` })
  name?: string;

  @IsObject({ message: 'file must be a layout file (a JSON object)' })
  file!: Record<string, unknown>;
}

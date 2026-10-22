import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { EVENT_IMAGE_LIMITS } from '@queuepass/shared';

/** Spec 014 FR-008 (contracts/openapi.yaml `EventImageOrder`): every image of the event, in order. */
export class ReorderEventImagesDto {
  @IsArray({ message: 'imageIds must be a list' })
  @ArrayMaxSize(EVENT_IMAGE_LIMITS.maxCount, {
    message: `imageIds must list at most ${EVENT_IMAGE_LIMITS.maxCount} images`,
  })
  @ArrayUnique({ message: 'imageIds must not repeat an image' })
  @IsUUID('all', { each: true, message: 'each of imageIds must be a UUID' })
  imageIds!: string[];
}

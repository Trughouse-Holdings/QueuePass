/** Mirrors the Location schemas in contracts/openapi.yaml. */
export interface Location {
  id: string;
  name: string;
  address: string;
  seatingCapacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationInput {
  name: string;
  address: string;
  seatingCapacity: number;
}

export type LocationUpdate = Partial<LocationInput>;

export const LOCATION_LIMITS = {
  nameMaxLength: 200,
  addressMaxLength: 500,
} as const;

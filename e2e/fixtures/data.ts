// Spec 022 (research R8): every test makes its own venue, events, and tiers with unique names, so
// tests never share data, never meet the 60-minute rule, and run in any order and in parallel.
import type { TestInfo } from '@playwright/test';
import addresses from '../stack/geocoder-stub/addresses.json';
import type { Place } from './api';

/** `e2e 1-3f9a2c seated venue k7qz`: worker, test, what, and 4 random characters. */
export function uniqueName(testInfo: TestInfo, what: string): string {
  const random = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `e2e ${testInfo.parallelIndex}-${testInfo.testId.slice(0, 6)} ${what} ${random}`;
}

const place = (city: string): Place => {
  const a = addresses.find((x) => x.city === city && x.street !== '937 Phillips Ln');
  if (!a) throw new Error(`no stand-in address in ${city}`);
  return { street: a.street, city: a.city, state: a.state as Place['state'], zip: a.zip };
};

/** The stand-in's test addresses (research R4), one per zone; not the demo data's two. */
export const PLACES = {
  louisville: place('Louisville'), // Eastern
  chicago: place('Chicago'), // Central
  phoenix: place('Phoenix'), // Arizona
  losAngeles: place('Los Angeles'), // Pacific
} as const;

/** An instant `h` hours from now, on a whole minute. */
export function startsInHours(h: number): Date {
  return new Date(Math.floor((Date.now() + h * 3_600_000) / 60_000) * 60_000);
}

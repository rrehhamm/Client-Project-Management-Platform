// Money form fields: decimal text in the UI, integer minor units in the API (D-01).
import { fromMinor, toMinor } from '@cpm/shared';
import { z } from 'zod';

/** Zod rule for an optional amount typed as text in `currency`. */
export const moneyText = (currency) =>
  z
    .string()
    .trim()
    .refine(
      (v) => {
        if (v === '') return true;
        try {
          return toMinor(v, currency) >= 0n;
        } catch {
          return false;
        }
      },
      { message: 'Enter an amount like 1250.500' },
    );

/** '' → null, '12.5' → minor units (number). */
export const textToMinor = (text, currency) => (text === '' || text === null || text === undefined ? null : Number(toMinor(text, currency)));

/** minor units → '' or decimal text for a form field. */
export const minorToText = (minor, currency) => (minor === null || minor === undefined ? '' : fromMinor(minor, currency));

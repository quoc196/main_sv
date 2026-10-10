import { z } from 'zod';

export const LISTING_TYPES = ['room', 'mini_apartment', 'house', 'shared'];
export const WATER_UNITS = ['m3', 'person', 'included'];
export const GENDERS = ['any', 'male', 'female'];
export const REPORT_REASONS = ['scam', 'wrong_info', 'already_rented', 'duplicate', 'other'];

// Caps are sanity limits, not business rules: they keep a typo (an extra
// three zeros) from landing, and keep the cost estimate far from overflow.
const vnd = (max) => z.coerce.number().int().min(0).max(max);
const fee = (max) => vnd(max).nullable().optional();

const idParams = z.object({ id: z.string().uuid('id must be a UUID') });

const fields = {
  type: z.enum(LISTING_TYPES),
  title: z.string().trim().min(10).max(150),
  description: z.string().trim().max(5000).default(''),

  price: vnd(500_000_000),
  deposit: fee(1_000_000_000),
  areaM2: z.coerce.number().positive().max(10_000),
  maxOccupants: z.coerce.number().int().positive().max(50).nullable().optional(),

  // The province follows from the ward, so the client sends only the ward.
  wardCode: z.string().regex(/^\d{5}$/, 'wardCode is 5 digits'),
  addressDetail: z.string().trim().min(1).max(255),
  lat: z.coerce.number().min(8).max(24),
  lng: z.coerce.number().min(102).max(118),

  // null / omitted = included in the rent.
  electricityPrice: fee(20_000),
  waterPrice: fee(1_000_000),
  waterUnit: z.enum(WATER_UNITS).default('included'),
  wifiFee: fee(5_000_000),
  parkingFee: fee(5_000_000),
  otherFeesNote: z.string().trim().max(500).nullable().optional(),

  // "HH:MM"; null = no curfew.
  curfewTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'curfewTime is HH:MM')
    .nullable()
    .optional(),
  sharedWithOwner: z.boolean().default(false),
  genderPreference: z.enum(GENDERS).default('any'),
  petsAllowed: z.boolean().default(false),
  availableFrom: z.string().date().nullable().optional(),

  amenities: z
    .array(z.string().min(1).max(40))
    .max(30)
    .transform((codes) => [...new Set(codes)])
    .default([]),
};

const waterPriced = (v) =>
  v.waterUnit === undefined || v.waterUnit === 'included' || v.waterPrice != null;
const waterMessage = { message: 'waterPrice is required unless waterUnit is "included"' };

export const createListingSchema = {
  body: z.object(fields).refine(waterPriced, waterMessage),
};

// .partial() drops the defaults too, so an omitted field stays untouched.
export const updateListingSchema = {
  params: idParams,
  body: z
    .object(fields)
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
    .refine(waterPriced, waterMessage),
};

export const listingIdSchema = { params: idParams };

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
const csvQuery = z.string().transform((v) => [
  ...new Set(
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  ),
]);

export const searchListingsSchema = {
  query: z
    .object({
      q: z.string().trim().min(1).max(100).optional(),
      province: z
        .string()
        .regex(/^\d{2}$/)
        .optional(),
      ward: z
        .string()
        .regex(/^\d{5}$/)
        .optional(),
      type: z.enum(LISTING_TYPES).optional(),
      minPrice: z.coerce.number().int().min(0).optional(),
      maxPrice: z.coerce.number().int().min(0).optional(),
      minArea: z.coerce.number().min(0).optional(),
      amenities: csvQuery.optional(),
      // "I am male": shows listings for men and for anyone.
      gender: z.enum(['male', 'female']).optional(),
      pets: booleanQuery.optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(0.1).max(50).default(5),
      sort: z.enum(['newest', 'price_asc', 'price_desc', 'distance']).default('newest'),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(50).default(20),
    })
    .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
      message: 'lat and lng go together',
    })
    .refine((v) => v.sort !== 'distance' || v.lat !== undefined, {
      message: 'sort=distance needs lat and lng',
    }),
};

const pageQuery = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
};

export const myListingsSchema = {
  query: z.object({
    status: z.enum(['pending', 'active', 'rejected', 'rented', 'hidden']).optional(),
    ...pageQuery,
  }),
};

export const pageSchema = { query: z.object(pageQuery) };

// What an owner may do by hand; approval and rejection are admin actions.
export const setStatusSchema = {
  params: idParams,
  body: z.object({ status: z.enum(['active', 'rented', 'hidden']) }),
};

export const imageParamsSchema = {
  params: z.object({ id: z.string().uuid(), imageId: z.string().uuid() }),
};

export const reportSchema = {
  params: idParams,
  body: z.object({
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(1000).optional(),
  }),
};

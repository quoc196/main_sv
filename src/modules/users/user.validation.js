import { z } from 'zod';

/**
 * Lower-cased and trimmed here so the UNIQUE index on users.email is actually
 * case-insensitive: "A@b.com" and "a@b.com" must not both be storable.
 */
const email = z.string().trim().toLowerCase().email();

export const listUsersSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    q: z.string().trim().optional(),
  }),
};

export const getUserSchema = {
  params: z.object({ id: z.string().uuid('id must be a UUID') }),
};

export const createUserSchema = {
  body: z.object({
    name: z.string().trim().min(1).max(120),
    email,
  }),
};

export const updateUserSchema = {
  params: getUserSchema.params,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      email: email.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' }),
};

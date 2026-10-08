import { z } from 'zod';

/**
 * Lower-cased and trimmed here so the UNIQUE index on users.email is actually
 * case-insensitive: "A@b.com" and "a@b.com" must not both be storable.
 */
export const email = z.string().trim().toLowerCase().email();

/**
 * Length is the policy, not character classes: a long passphrase beats a short
 * string with a digit forced in. The upper bound keeps a megabyte "password"
 * from tying up scrypt.
 */
export const password = z.string().min(8).max(128);

export const ROLES = ['user', 'admin'];

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

// Admin-only. Password is optional: an account created without one exists but
// cannot log in until a password is set.
export const createUserSchema = {
  body: z.object({
    name: z.string().trim().min(1).max(120),
    email,
    password: password.optional(),
    role: z.enum(ROLES).optional(),
  }),
};

export const updateUserSchema = {
  params: getUserSchema.params,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      email: email.optional(),
      password: password.optional(),
      role: z.enum(ROLES).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' }),
};

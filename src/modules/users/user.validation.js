import { z } from 'zod';


export const email = z.string().trim().toLowerCase().email();

export const password = z.string().min(8).max(128);

export const ROLES = ['user', 'admin'];

export const phone = z
  .string()
  .transform((v) => v.replace(/[\s.-]/g, '').replace(/^(\+84|84)/, '0'))
  .pipe(z.string().regex(/^0[35789]\d{8}$/, 'Số điện thoại di động Việt Nam không hợp lệ'));

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
    password: password.string(),
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

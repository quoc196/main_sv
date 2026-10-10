import { z } from 'zod';

import { email, password, phone } from '../users/user.validation.js';

export const registerSchema = {
  body: z.object({
    name: z.string().trim().min(1).max(120),
    email,
    password,
  }),
};

// No length policy on login: an account made under an older, looser policy
// must still be able to sign in. The cap is only there to bound scrypt.
export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1).max(128),
  }),
};

export const refreshTokenSchema = {
  body: z.object({ refreshToken: z.string().min(1).max(200) }),
};

export const updateProfileSchema = {
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      phone: phone.nullable().optional(),
      avatarUrl: z.string().url().max(500).nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' }),
};

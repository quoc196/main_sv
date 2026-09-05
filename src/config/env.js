import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

/**
 * NODE_ENV is resolved BEFORE loading any file: the running environment decides
 * which file to read, never the other way around.
 */
export const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Loaded from the most specific to the least specific.
 * dotenv never overrides a variable that already exists, so real process env
 * (systemd, Docker, CI, PM2, ...) always wins over any file.
 */
const CANDIDATES = [
  `.env.${NODE_ENV}.local`, // personal overrides, git-ignored
  `.env.${NODE_ENV}`, // per-environment values
  '.env', // shared defaults
];

export const loadedEnvFiles = [];

for (const file of CANDIDATES) {
  const fullPath = path.join(ROOT_DIR, file);
  if (!fs.existsSync(fullPath)) continue;
  dotenv.config({ path: fullPath });
  loadedEnvFiles.push(file);
}

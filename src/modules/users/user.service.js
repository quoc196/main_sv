import { randomUUID } from 'node:crypto';
import ApiError from '../../utils/ApiError.js';

/**
 * In-memory store standing in for a real repository — swap the body of these
 * functions for DB calls, the signatures are what the controller depends on.
 */
const users = new Map();

function seed() {
  const now = new Date().toISOString();
  const id = randomUUID();
  users.set(id, { id, name: 'Demo User', email: 'demo@example.com', createdAt: now, updatedAt: now });
}
seed();

export async function list({ page, limit, q }) {
  let items = [...users.values()];

  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(
      (u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)
    );
  }

  const total = items.length;
  const start = (page - 1) * limit;

  return { items: items.slice(start, start + limit), total };
}

export async function getById(id) {
  const user = users.get(id);
  if (!user) throw ApiError.notFound(`User ${id} not found`);
  return user;
}

export async function create({ name, email }) {
  const exists = [...users.values()].some((u) => u.email === email);
  if (exists) throw ApiError.conflict(`Email ${email} is already taken`);

  const now = new Date().toISOString();
  const user = { id: randomUUID(), name, email, createdAt: now, updatedAt: now };
  users.set(user.id, user);
  return user;
}

export async function update(id, patch) {
  const user = await getById(id);

  if (patch.email && patch.email !== user.email) {
    const taken = [...users.values()].some((u) => u.id !== id && u.email === patch.email);
    if (taken) throw ApiError.conflict(`Email ${patch.email} is already taken`);
  }

  const updated = { ...user, ...patch, updatedAt: new Date().toISOString() };
  users.set(id, updated);
  return updated;
}

export async function remove(id) {
  await getById(id);
  users.delete(id);
}

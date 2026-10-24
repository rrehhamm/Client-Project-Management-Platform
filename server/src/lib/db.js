// Single Prisma client for the process, using the node-postgres driver adapter (Prisma 7).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl }),
});

/** Readiness probe: true when the database answers. */
export async function pingDatabase() {
  await db.$queryRaw`SELECT 1`;
  return true;
}

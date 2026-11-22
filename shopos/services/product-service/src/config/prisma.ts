import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return prisma;
}

export async function isDatabaseReady(): Promise<boolean> {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}

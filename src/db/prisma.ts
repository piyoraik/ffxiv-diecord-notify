import { PrismaClient } from '@prisma/client';

export const buildDatabaseUrlFromPgEnv = (env: NodeJS.ProcessEnv): string | undefined => {
  const host = env.PGHOST;
  const user = env.PGUSER;
  const database = env.PGDATABASE;
  if (!host || !user || !database) {
    return undefined;
  }
  const port = env.PGPORT ?? '5432';
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = env.PGPASSWORD ? `:${encodeURIComponent(env.PGPASSWORD)}` : '';
  const credentials = `${encodedUser}${encodedPassword}`;
  const params: string[] = [];
  if (env.PGSSLMODE === 'require') {
    params.push('sslmode=require');
  }
  const suffix = params.length > 0 ? `?${params.join('&')}` : '';
  return `postgresql://${credentials}@${host}:${port}/${database}${suffix}`;
};

const ensureDatabaseUrl = (): void => {
  if (process.env.DATABASE_URL) {
    return;
  }
  const url = buildDatabaseUrlFromPgEnv(process.env);
  if (url) {
    process.env.DATABASE_URL = url;
  }
};

let prismaSingleton: PrismaClient | null = null;

export const getPrismaClient = (): PrismaClient => {
  if (!prismaSingleton) {
    ensureDatabaseUrl();
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
};

export const closePrismaClient = async (): Promise<void> => {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = null;
  }
};

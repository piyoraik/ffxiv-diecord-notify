import { getPrismaClient } from './prisma.js';

export const ensureSchema = async (): Promise<void> => {
  // Prisma を利用するため、テーブル作成はマイグレーションで管理する。
};

export const upsertRoster = async (
  guildId: string,
  name: string,
  jobCode?: string,
  emoji?: string,
  discordUserId?: string | null
): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.roster.upsert({
    where: {
      guildId_name: {
        guildId,
        name
      }
    },
    create: {
      guildId,
      name,
      jobCode: jobCode ?? null,
      emoji: emoji ?? null,
      discordUserId: discordUserId ?? null
    },
    update: {
      jobCode: jobCode ?? null,
      emoji: emoji ?? null,
      discordUserId: discordUserId ?? null,
      updatedAt: new Date()
    }
  });
};

export const deleteRoster = async (guildId: string, name: string): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.roster.deleteMany({
    where: {
      guildId,
      name
    }
  });
};

export const listRoster = async (
  guildId: string
): Promise<Array<{ name: string; jobCode?: string | null; emoji?: string | null }>> => {
  const prisma = getPrismaClient();
  const roster = await prisma.roster.findMany({
    where: { guildId },
    orderBy: { name: 'asc' },
    select: {
      name: true,
      jobCode: true,
      emoji: true
    }
  });
  return roster.map((member): { name: string; jobCode?: string | null; emoji?: string | null } => ({
    name: member.name,
    jobCode: member.jobCode,
    emoji: member.emoji
  }));
};

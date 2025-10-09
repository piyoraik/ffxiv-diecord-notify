import type { Guild } from 'discord.js';

// JobCode -> Discord カスタム絵文字の「名前」マッピング
// ご提供いただいた名前をそのまま使用します。
const JOB_CODE_TO_EMOJI_NAME: Record<string, string> = {
  VPR: 'Viper',
  SMN: 'Summoner',
  SAM: 'Samurai',
  RDM: 'RedMage',
  RPR: 'Reaper',
  PCT: 'Pictomancer',
  NIN: 'Ninja',
  MNK: 'Monk',
  MCH: 'Machinist',
  DRG: 'Dragoon',
  DNC: 'Dancer',
  BLM: 'BlackMage',
  BRD: 'Bard',
  WHM: 'WhiteMage',
  SCH: 'Scholar',
  SGE: 'Sage',
  AST: 'Astrologian',
  WAR: 'Warrior',
  PLD: 'Paladin',
  GNB: 'Gunbreaker',
  DRK: 'DarkKnight'
};

/**
 * ギルド内のカスタム絵文字から、ジョブコードに対応する絵文字タグを取得する。
 * 見つからない場合は null を返す。
 */
export const getGuildEmojiTagForJob = (guild: Guild | null | undefined, jobCode?: string | null): string | null => {
  if (!guild || !jobCode) return null;
  const name = JOB_CODE_TO_EMOJI_NAME[jobCode];
  if (!name) return null;
  // Note: partials 未考慮（通常は cache に存在）。なければ fetch で補完も可能。
  const emoji = guild.emojis.cache.find(e => e.name === name);
  if (!emoji || !emoji.id || !emoji.name) return null;
  return `<:${emoji.name}:${emoji.id}>`;
};

/**
 * 整形済みテキスト中の [JOB] をギルド絵文字へ置換する。
 * 例: "[PLD] Name" → "<:Paladin:123> Name"
 */
export const replaceJobTagsWithEmojis = (content: string, guild: Guild | null | undefined): string => {
  if (!guild) return content;
  return content.replace(/\[(PLD|WAR|DRK|GNB|WHM|SCH|AST|SGE|MNK|DRG|NIN|SAM|RPR|VPR|BRD|MCH|DNC|BLM|SMN|RDM|PCT)\]/g, (_m, code) => {
    const tag = getGuildEmojiTagForJob(guild, code);
    return tag ?? `[${code}]`;
  });
};


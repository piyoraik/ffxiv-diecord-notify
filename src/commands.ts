import { SlashCommandBuilder } from 'discord.js';

// `/test` コマンド定義（任意の日付引数を受け取り日次サマリを返す）
export const testCommand = new SlashCommandBuilder()
  .setName('test')
  .setDescription('ヒストリー形式で攻略ログの要約を返します。')
  .addStringOption(option =>
    option
      .setName('date')
      .setDescription('対象日 (YYYY-MM-DD)。指定しない場合は最新日を使用します。')
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('ephemeral')
      .setDescription('true でエフェメラル返信、false で通常返信 (省略時は true)')
      .setRequired(false)
  );

export const commandList = [testCommand];

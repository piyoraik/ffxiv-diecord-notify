import { SlashCommandBuilder } from 'discord.js';

/**
 * `/test` コマンド定義（任意の日付引数を受け取り日次サマリを返す）。
 * - `date`: YYYY-MM-DD 形式の対象日（省略可）
 * - `ephemeral`: エフェメラル返信の有無（既定 true）
 */
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

/**
 * `/dps` コマンド定義（攻略別の DPS ランキングを表示）。
 * - `date`: YYYY-MM-DD 形式の対象日（省略可）
 * - `content`: コンテンツ名の部分一致フィルタ（省略可）
 * - `index`: 同名コンテンツが複数ある場合に 1 始まりの番号で指定
 * - `ephemeral`: エフェメラル返信の有無（既定 true）
 */
export const dpsCommand = new SlashCommandBuilder()
  .setName('dps')
  .setDescription('攻略ごとの DPS ランキングを表示します。')
  .addStringOption(option =>
    option
      .setName('date')
      .setDescription('対象日 (YYYY-MM-DD)。指定しない場合は最新日を使用します。')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('content')
      .setDescription('コンテンツ名で絞り込みます（部分一致）')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('index')
      .setDescription('同名コンテンツが複数ある場合の対象番号 (1 始まり)')
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('ephemeral')
      .setDescription('true でエフェメラル返信、false で通常返信 (省略時は true)')
      .setRequired(false)
  );

// 登録対象のコマンド一覧はファイル末尾でまとめて公開します。

/**
 * `/version` コマンド定義（package.json のバージョンを返す）。
 */
export const versionCommand = new SlashCommandBuilder()
  .setName('version')
  .setDescription('このボットのバージョンを表示します。');

// 既存の配列に追加
export const commandList = [testCommand, dpsCommand, versionCommand];

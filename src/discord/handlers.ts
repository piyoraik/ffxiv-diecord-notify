import type { ChatInputCommandInteraction } from 'discord.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// JSON import の互換性（Node の import attributes 差異）を避けるため createRequire を使用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json');
import { appSettings } from '../config.js';
import {
  summarizeLogsByDate,
  formatSummaryMessage,
  formatDpsListMessage,
  formatDpsDetailMessage,
  fetchDailyCombatSummary
} from '../logParser.js';

/**
 * `/test` コマンドの実装（依存注入版）。
 * テスト時は `deps` を差し替えて振る舞いを検証できます。
 */
export const handleTestCommandWith = async (
  interaction: ChatInputCommandInteraction,
  deps: {
    summarize: typeof summarizeLogsByDate;
    format: typeof formatSummaryMessage;
  }
): Promise<void> => {
  const requestedDate = interaction.options.getString('date') ?? undefined;
  const ephemeral = interaction.options.getBoolean('ephemeral');
  const shouldUseEphemeral = ephemeral ?? true;

  try {
    await interaction.deferReply({ ephemeral: shouldUseEphemeral });
    const { summary, availableDates } = await deps.summarize(requestedDate);
    if (!summary) {
      await interaction.editReply('Loki から対象日のログが見つかりませんでした。設定を確認してください。');
      return;
    }
    const message = deps.format(summary, availableDates);
    await interaction.editReply({ content: message });
  } catch (error) {
    const description = error instanceof Error ? error.message : 'unknown error';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`解析中にエラーが発生しました: ${description}`);
    } else {
      await interaction.reply({ content: `解析中にエラーが発生しました: ${description}`, ephemeral: shouldUseEphemeral });
    }
  }
};

/**
 * `/test` コマンド（本番用ラッパー）。
 */
export const handleTestCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  return handleTestCommandWith(interaction, {
    summarize: summarizeLogsByDate,
    format: formatSummaryMessage
  });
};

/**
 * `/dps` コマンドの実装（依存注入版）。
 */
export const handleDpsCommandWith = async (
  interaction: ChatInputCommandInteraction,
  deps: {
    fetchDaily: typeof fetchDailyCombatSummary;
    formatList: typeof formatDpsListMessage;
    formatDetail: typeof formatDpsDetailMessage;
  }
): Promise<void> => {
  const requestedDate = interaction.options.getString('date') ?? undefined;
  const contentFilter = interaction.options.getString('content') ?? undefined;
  const indexOption = interaction.options.getInteger('index');
  const ephemeral = interaction.options.getBoolean('ephemeral');
  const shouldUseEphemeral = ephemeral ?? true;

  try {
    await interaction.deferReply({ ephemeral: shouldUseEphemeral });
    const daily = await deps.fetchDaily(requestedDate);
    let segments = daily.segments;
    if (contentFilter) {
      const lowered = contentFilter.toLowerCase();
      segments = segments.filter(segment => segment.content.toLowerCase().includes(lowered));
    }

    if (segments.length === 0) {
      await interaction.editReply('指定条件に合致する攻略ログが見つかりませんでした。');
      return;
    }

    let selectedSegment: any = null;

    if (typeof indexOption === 'number') {
      if (indexOption < 1 || indexOption > segments.length) {
        await interaction.editReply(`index は 1 〜 ${segments.length} の範囲で指定してください。`);
        return;
      }
      selectedSegment = segments[indexOption - 1];
    } else if (segments.length === 1) {
      selectedSegment = segments[0];
    } else {
      const listMessage = deps.formatList(daily.date, segments);
      await interaction.editReply(listMessage);
      return;
    }

    const detail = deps.formatDetail(selectedSegment, daily.date);
    await interaction.editReply(detail);
  } catch (error) {
    const description = error instanceof Error ? error.message : 'unknown error';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`解析中にエラーが発生しました: ${description}`);
    } else {
      await interaction.reply({ content: `解析中にエラーが発生しました: ${description}`, ephemeral: shouldUseEphemeral });
    }
  }
};

/**
 * `/dps` コマンド（本番用ラッパー）。
 */
export const handleDpsCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  return handleDpsCommandWith(interaction, {
    fetchDaily: fetchDailyCombatSummary,
    formatList: formatDpsListMessage,
    formatDetail: formatDpsDetailMessage
  });
};

/**
 * `/version` コマンド: package.json のバージョンを返す。
 */
export const handleVersionCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const version = (pkg as any)?.version ?? 'unknown';
  const builtAt = process.env.BUILD_TIMESTAMP ?? new Date().toISOString();
  const tz = appSettings.timeZone() || 'Asia/Tokyo';
  let builtLocal = builtAt;
  try {
    const d = new Date(builtAt);
    if (!Number.isNaN(d.getTime())) {
      const datePart = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
      const timePart = new Intl.DateTimeFormat('ja-JP', {
        timeZone: tz,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(d);
      const tzLabel = tz === 'Asia/Tokyo' ? 'JST' : tz;
      builtLocal = `${datePart} ${timePart} ${tzLabel}`;
    }
  } catch {
    // keep original builtAt string
  }
  await interaction.reply({ content: `version: v${version} (built: ${builtLocal})`, ephemeral: true });
};

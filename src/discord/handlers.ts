import type { ChatInputCommandInteraction } from 'discord.js';
import pkg from '../../package.json' assert { type: 'json' };
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
  await interaction.reply({ content: `version: v${version} (built: ${builtAt})`, ephemeral: true });
};

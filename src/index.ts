import { Client, Events, GatewayIntentBits, type ChatInputCommandInteraction } from 'discord.js';
import { discordConfig } from './config.js';
import {
  fetchDailyCombatSummary,
  formatDpsDetailMessage,
  formatDpsListMessage,
  formatSummaryMessage,
  summarizeLogsByDate
} from './logParser.js';

const token = discordConfig.token();
// ギルド関連イベントのみ要求する軽量クライアントを生成
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 起動完了時のログ出力
client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// `/test` 実行時にログ解析しチャンネルへ返信を行う
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  if (interaction.commandName === 'test') {
    await handleTestCommand(interaction);
    return;
  }

  if (interaction.commandName === 'dps') {
    await handleDpsCommand(interaction);
  }
});

/**
 * `/test` コマンドの実装。指定日（省略時は最新対象日）の攻略履歴を要約して返信する。
 * @param interaction Discord のチャット入力コマンド Interaction
 */
const handleTestCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const requestedDate = interaction.options.getString('date') ?? undefined;
  const ephemeral = interaction.options.getBoolean('ephemeral');
  const shouldUseEphemeral = ephemeral ?? true;

  try {
    await interaction.deferReply({ ephemeral: shouldUseEphemeral });
    const { summary, availableDates } = await summarizeLogsByDate(requestedDate);
    if (!summary) {
      await interaction.editReply('Loki から対象日のログが見つかりませんでした。設定を確認してください。');
      return;
    }
    const message = formatSummaryMessage(summary, availableDates);
    await interaction.editReply({ content: message });
  } catch (error) {
    console.error('Failed to handle /test command', error);
    const description = error instanceof Error ? error.message : 'unknown error';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`解析中にエラーが発生しました: ${description}`);
    } else {
      await interaction.reply({ content: `解析中にエラーが発生しました: ${description}`, ephemeral: shouldUseEphemeral });
    }
  }
};

/**
 * `/dps` コマンドの実装。指定条件で攻略一覧を絞り、単一に定まれば詳細、複数なら一覧を表示する。
 * @param interaction Discord のチャット入力コマンド Interaction
 */
const handleDpsCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const requestedDate = interaction.options.getString('date') ?? undefined;
  const contentFilter = interaction.options.getString('content') ?? undefined;
  const indexOption = interaction.options.getInteger('index');
  const ephemeral = interaction.options.getBoolean('ephemeral');
  const shouldUseEphemeral = ephemeral ?? true;

  try {
    await interaction.deferReply({ ephemeral: shouldUseEphemeral });
    const daily = await fetchDailyCombatSummary(requestedDate);
    let segments = daily.segments;
    if (contentFilter) {
      const lowered = contentFilter.toLowerCase();
      segments = segments.filter(segment => segment.content.toLowerCase().includes(lowered));
    }

    if (segments.length === 0) {
      await interaction.editReply('指定条件に合致する攻略ログが見つかりませんでした。');
      return;
    }

    let selectedSegment = null;

    if (typeof indexOption === 'number') {
      if (indexOption < 1 || indexOption > segments.length) {
        await interaction.editReply(`index は 1 〜 ${segments.length} の範囲で指定してください。`);
        return;
      }
      selectedSegment = segments[indexOption - 1];
    } else if (segments.length === 1) {
      selectedSegment = segments[0];
    } else {
      const listMessage = formatDpsListMessage(daily.date, segments);
      await interaction.editReply(listMessage);
      return;
    }

    const detail = formatDpsDetailMessage(selectedSegment, daily.date);
    await interaction.editReply(detail);
  } catch (error) {
    console.error('Failed to handle /dps command', error);
    const description = error instanceof Error ? error.message : 'unknown error';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`解析中にエラーが発生しました: ${description}`);
    } else {
      await interaction.reply({ content: `解析中にエラーが発生しました: ${description}`, ephemeral: shouldUseEphemeral });
    }
  }
};

// Discord への接続に失敗した場合は異常終了
client.login(token).catch(error => {
  console.error('Failed to login to Discord', error);
  process.exit(1);
});

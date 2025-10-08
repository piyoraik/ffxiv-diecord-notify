import { Client, Events, GatewayIntentBits } from 'discord.js';
import { discordConfig } from './config.js';
import { formatSummaryMessage, summarizeLogsByDate } from './logParser.js';

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
  if (interaction.commandName !== 'test') {
    return;
  }

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
});

// Discord への接続に失敗した場合は異常終了
client.login(token).catch(error => {
  console.error('Failed to login to Discord', error);
  process.exit(1);
});

import { Client, Events, GatewayIntentBits } from 'discord.js';
import { discordConfig } from './config.js';
import { handleDpsCommand, handleTestCommand, handleVersionCommand, handleRosterCommand } from './discord/handlers.js';

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

  if (interaction.commandName === 'version') {
    await handleVersionCommand(interaction);
    }
  if (interaction.commandName === 'roster') {
    await handleRosterCommand(interaction);
  }
});

/**
 * `/test` コマンドの実装。指定日（省略時は最新対象日）の攻略履歴を要約して返信する。
 * @param interaction Discord のチャット入力コマンド Interaction
 */

// Discord への接続に失敗した場合は異常終了
client.login(token).catch(error => {
  console.error('Failed to login to Discord', error);
  process.exit(1);
});

import { REST, Routes } from 'discord.js';
import { commandList } from './commands.js';
import { discordConfig } from './config.js';

/**
 * 依存関係を受け取ってコマンド登録を実行する（テスト用）。
 */
export const registerCommandsWith = async (
  rest: InstanceType<typeof REST>,
  routes: typeof Routes,
  clientId: string,
  guildId: string,
  commands: { toJSON: () => unknown }[]
): Promise<void> => {
  await (rest as any).put(routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map(c => c.toJSON())
  });
};

/**
 * ギルドスコープでスラッシュコマンドを登録するエントリポイント。
 * エラー発生時はプロセスの終了コードを 1 に設定する。
 */
export const registerCommands = async (): Promise<void> => {
  const token = discordConfig.token();
  const clientId = discordConfig.clientId();
  const guildId = discordConfig.guildId();
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering application commands...');
    await registerCommandsWith(rest as any, Routes, clientId, guildId, commandList);
    console.log('Successfully registered commands.');
  } catch (error) {
    console.error('Failed to register commands', error);
    process.exitCode = 1;
  }
};

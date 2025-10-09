import { REST, Routes } from 'discord.js';
import { commandList } from './commands.js';
import { discordConfig } from './config.js';

const token = discordConfig.token();
const clientId = discordConfig.clientId();
const guildId = discordConfig.guildId();

const rest = new REST({ version: '10' }).setToken(token);

/**
 * ギルドスコープでスラッシュコマンドを登録するエントリポイント。
 * エラー発生時はプロセスの終了コードを 1 に設定する。
 */
const main = async (): Promise<void> => {
  try {
    console.log('Registering application commands...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandList.map(command => command.toJSON())
    });
    console.log('Successfully registered commands.');
  } catch (error) {
    console.error('Failed to register commands', error);
    process.exitCode = 1;
  }
};

void main();

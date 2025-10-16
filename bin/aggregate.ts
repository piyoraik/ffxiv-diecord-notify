#!/usr/bin/env tsx
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { runSegmentAggregationJob } from '../src/jobs/segmentAggregation.js';
import { runRosterAggregationJob } from '../src/jobs/rosterAggregation.js';

const main = async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('aggregate')
    .command('windows', 'Run segment aggregation job', y =>
      y.option('max-windows', {
        type: 'number',
        desc: 'Maximum number of windows to process'
      })
    )
    .command('roster', 'Run roster presence aggregation job', y =>
      y
        .option('max-segments', {
          type: 'number',
          desc: 'Maximum number of segments to process'
        })
        .option('guild', {
          type: 'array',
          desc: 'Guild IDs to filter roster'
        })
    )
    .demandCommand(1, 'Please specify a subcommand (windows or roster).')
    .help()
    .parseAsync();

  const command = argv._[0];
  if (command === 'windows') {
    await runSegmentAggregationJob(typeof argv['max-windows'] === 'number' ? argv['max-windows'] : undefined);
    return;
  }
  if (command === 'roster') {
    await runRosterAggregationJob({
      maxSegments: typeof argv['max-segments'] === 'number' ? argv['max-segments'] : undefined,
      guildIds: (argv.guild as string[] | undefined) ?? undefined
    });
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
};

main().catch(error => {
  console.error('[aggregate-cli] failed', error);
  process.exit(1);
});

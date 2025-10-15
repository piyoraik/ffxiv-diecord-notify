import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Definitions フォルダのアクション一覧から abilityId (hex) -> job code を組み立てる。
 * 先頭の `0x` は付けず、ログ出力と同じ 16 進表記（大文字）で保持する。
 */

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DEFINITION_DIRS = [
  path.join(MODULE_DIR, '../Definitions'),
  path.join(MODULE_DIR, '../../src/Definitions'),
  path.resolve(process.cwd(), 'src/Definitions')
];

const DEFINITION_DIR = CANDIDATE_DEFINITION_DIRS.find(dir => existsSync(dir));

const JOB_NAME_TO_CODE: Record<string, string> = {
  'astrologian': 'AST',
  'bard': 'BRD',
  'black mage': 'BLM',
  'dancer': 'DNC',
  'dark knight': 'DRK',
  'dragoon': 'DRG',
  'gunbreaker': 'GNB',
  'machinist': 'MCH',
  'monk': 'MNK',
  'ninja': 'NIN',
  'paladin': 'PLD',
  'pictomancer': 'PCT',
  'reaper': 'RPR',
  'red mage': 'RDM',
  'sage': 'SGE',
  'samurai': 'SAM',
  'scholar': 'SCH',
  'summoner': 'SMN',
  'viper': 'VPR',
  'warrior': 'WAR',
  'white mage': 'WHM'
};

const HEX_ID_PATTERN = /^[0-9a-f]+$/i;

const parseDefinitionFile = (raw: string, fileName: string): any | null => {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const sanitized = raw.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(sanitized);
    } catch (error) {
      console.warn(`Failed to parse ability definition: ${fileName}`, error);
      return null;
    }
  }
};

const loadAbilityJobMap = (): Record<string, string> => {
  const entries: Record<string, string> = {};
  if (!DEFINITION_DIR) {
    console.warn('Ability definitions directory not found. abilityJobMap will be empty.');
    return entries;
  }
  const files = readdirSync(DEFINITION_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'));

  for (const dirent of files) {
    const filePath = path.join(DEFINITION_DIR, dirent.name);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parseDefinitionFile(raw, dirent.name);
    if (!parsed) {
      continue;
    }

    const jobName = typeof parsed?.job === 'string' ? parsed.job.trim().toLowerCase() : '';
    const jobCode = JOB_NAME_TO_CODE[jobName];
    if (!jobCode) {
      continue;
    }

    const actions: unknown[] = Array.isArray(parsed.actions) ? parsed.actions : [];
    for (const action of actions) {
      if (typeof action !== 'object' || action === null) {
        continue;
      }

      for (const key of Object.keys(action as Record<string, unknown>)) {
        if (!HEX_ID_PATTERN.test(key)) {
          continue;
        }
        const abilityId = key.toUpperCase();
        const existing = entries[abilityId];
        if (existing && existing !== jobCode) {
          // 万が一競合があった場合は最初のジョブを優先し、警告だけ出す。
          console.warn(
            `abilityJobMap conflict for ${abilityId}: keeping ${existing}, ignoring ${jobCode} from ${dirent.name}`
          );
          continue;
        }
        entries[abilityId] = jobCode;
      }
    }
  }

  return entries;
};

export const abilityJobMap: Record<string, string> = loadAbilityJobMap();

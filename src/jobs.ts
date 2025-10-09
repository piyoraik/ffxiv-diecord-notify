export type Role = 'T' | 'H' | 'D';

// 最小の JobID → Jobコード（英略）マッピング（cactbot 準拠の一部）。
// 必要に応じて拡張可能。
const JOB_ID_TO_CODE: Record<number, string> = {
  19: 'PLD',
  20: 'MNK',
  21: 'WAR',
  22: 'DRG',
  23: 'BRD',
  24: 'WHM',
  25: 'BLM',
  27: 'SMN',
  28: 'SCH',
  30: 'NIN',
  31: 'MCH',
  32: 'DRK',
  33: 'AST',
  34: 'SAM',
  35: 'RDM',
  37: 'GNB',
  38: 'DNC',
  39: 'RPR',
  40: 'SGE',
  41: 'VPR',
  42: 'PCT'
};

const JOB_CODE_TO_ROLE: Record<string, Role> = {
  PLD: 'T', WAR: 'T', DRK: 'T', GNB: 'T',
  WHM: 'H', SCH: 'H', AST: 'H', SGE: 'H',
  MNK: 'D', DRG: 'D', BRD: 'D', BLM: 'D',
  SMN: 'D', NIN: 'D', MCH: 'D', SAM: 'D',
  RDM: 'D', DNC: 'D', RPR: 'D', VPR: 'D', PCT: 'D'
};

export const jobCodeForId = (id?: number | null): string | undefined =>
  typeof id === 'number' ? JOB_ID_TO_CODE[id] : undefined;

export const roleForJobCode = (code?: string | null): Role | undefined =>
  code ? JOB_CODE_TO_ROLE[code] : undefined;


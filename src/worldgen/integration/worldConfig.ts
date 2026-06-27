import { type WorldConfigDoc, type WorldSpawnConfig } from './worldConfigData.js';
import { getWorldConfig as getWorldConfigFromService } from './worldService.js';

export type { WorldSpawnConfig };

export async function getWorldConfig(worldId?: string): Promise<WorldConfigDoc> {
  return getWorldConfigFromService(worldId);
}

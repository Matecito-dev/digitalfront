#!/usr/bin/env npx tsx
/** Limpia servidores de test y workers vitest huérfanos. Uso: npm run test:cleanup */
import { cleanupTestViewerServers } from "./__tests__/testViewerServer.js";

const killed = await cleanupTestViewerServers();
if (killed > 0) {
  console.log(`[test:cleanup] ${killed} servidor(es) de test terminados`);
}

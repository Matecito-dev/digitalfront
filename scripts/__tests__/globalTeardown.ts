import { cleanupTestViewerServers } from "./testViewerServer.js";

export default async function globalTeardown(): Promise<void> {
  await cleanupTestViewerServers();
}

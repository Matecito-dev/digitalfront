#!/usr/bin/env node
/**
 * Compare loadtest JSON reports (before/after).
 *
 * Usage:
 *   npm run loadtest:ws -- --scenario=cluster --json > before.json
 *   node scripts/loadtest-report.mjs before.json after.json
 */
import fs from "node:fs";

const files = process.argv.slice(2);
if (files.length < 1) {
  console.error("Usage: node scripts/loadtest-report.mjs <report.json> [report2.json ...]");
  process.exit(1);
}

function load(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function row(label, values) {
  console.log(`${label.padEnd(22)} ${values.map(v => String(v).padStart(12)).join("")}`);
}

const reports = files.map(load);

row("file", files.map(f => f.split("/").pop()));
row("scenario", reports.map(r => r.scenario));
row("clients", reports.map(r => r.clients));
row("auth %", reports.map(r => `${(r.authRate * 100).toFixed(1)}%`));
row("deltas", reports.map(r => r.deltas));
row("order_err", reports.map(r => r.orderErrs));
row("firstDelta avg", reports.map(r => r.firstDeltaMs?.avg ?? "—"));
row("firstDelta p95", reports.map(r => r.firstDeltaMs?.p95 ?? "—"));
row("KB/s/client", reports.map(r => r.kbPerClientPerSec?.toFixed(1) ?? "—"));

if (reports.length === 2) {
  const [a, b] = reports;
  const deltaAuth = ((b.authRate - a.authRate) * 100).toFixed(1);
  const deltaOrderErr = b.orderErrs - a.orderErrs;
  const deltaP95 = (a.firstDeltaMs?.p95 != null && b.firstDeltaMs?.p95 != null)
    ? (b.firstDeltaMs.p95 - a.firstDeltaMs.p95)
    : null;
  console.log("\nΔ (second − first):");
  console.log(`  auth rate:   ${deltaAuth} pp`);
  console.log(`  order_err:   ${deltaOrderErr >= 0 ? "+" : ""}${deltaOrderErr}`);
  if (deltaP95 != null) console.log(`  firstDelta p95: ${deltaP95 >= 0 ? "+" : ""}${deltaP95} ms`);
}

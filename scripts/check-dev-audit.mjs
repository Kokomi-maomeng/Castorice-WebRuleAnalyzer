// npm reports transitive findings once for the affected package and again for
// its dependents. Keep the high-severity gate on the actual advisories.
import fs from 'node:fs';

const audit = JSON.parse(fs.readFileSync(0, 'utf8'));
if (audit.error || audit.auditReportVersion !== 2 || !audit.vulnerabilities) {
  throw new Error('npm did not return a complete dependency audit');
}
const lock = JSON.parse(fs.readFileSync(new URL('../frontend/package-lock.json', import.meta.url), 'utf8'));
const high = new Set(['high', 'critical']);
let failed = false;
for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
  for (const advisory of finding.via) {
    if (typeof advisory === 'string' || !high.has(advisory.severity)) continue;
    // https://github.com/advisories/GHSA-fc5q-39xc-vjpf has no published fix.
    // This exact build/test dependency processes repository-controlled globs.
    // The production audit is required separately. Remove after upstream fixes it.
    const knownToolchainIssue =
      name === 'picomatch' &&
      advisory.url === 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' &&
      finding.nodes.length > 0 &&
      finding.nodes.every((node) => lock.packages[node]?.dev === true &&
        lock.packages[node]?.version === '4.0.7');
    if (knownToolchainIssue) {
      console.warn('Known development-only advisory: ' + advisory.url);
    } else {
      console.error(`${advisory.severity}: ${name} ${advisory.url}`);
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;

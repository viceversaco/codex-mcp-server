// Test setup: isolate HOME so FileSessionStorage doesn't pollute the
// user's real ~/.codex-mcp/sessions directory during test runs.
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const testHome = path.join(
  os.tmpdir(),
  `codex-mcp-test-home-${process.pid}-${Date.now()}`
);
fs.mkdirSync(testHome, { recursive: true });
process.env.HOME = testHome;
// Also override USERPROFILE for Windows-style homedir() resolution
process.env.USERPROFILE = testHome;

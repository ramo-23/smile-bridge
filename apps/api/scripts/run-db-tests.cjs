const { spawnSync } = require('node:child_process');

const jest = [require.resolve('jest/bin/jest'), '--config', 'jest.db.config.cjs', '--runInBand'];
const zones = ['Pacific/Kiritimati', 'America/Los_Angeles'];

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [...jest, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  }).status;
}

let failed = run(process.argv.slice(2)) !== 0;
for (const zone of zones) {
  const status = run(['test/db/billing-payments', '-t', `process TZ ${zone}`], { TZ: zone, CASHUP_TZ: zone });
  failed = failed || status !== 0;
}
process.exit(failed ? 1 : 0);
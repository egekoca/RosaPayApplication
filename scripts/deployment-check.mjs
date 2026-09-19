const required = [
  'DATABASE_URL',
  'API_SESSION_SECRET',
  'STELLAR_RELAYER_SECRET',
  'STELLAR_ADMIN_SECRET',
  'STELLAR_SETTLEMENT_CONTRACT_ID',
  'STELLAR_WALLET_WASM_HASH',
];

const checks = [];
const record = (name, ok, detail) => checks.push({name, ok, ...(detail ? {detail} : {})});

for (const name of required) {
  const value = process.env[name]?.trim();
  record(name, Boolean(value), value ? 'set' : 'missing');
}

const databaseUrl = process.env.DATABASE_URL?.trim();
record('DATABASE_URL scheme', Boolean(databaseUrl && /^postgres(?:ql)?:\/\//i.test(databaseUrl)), 'postgres URL');
record('DATABASE_SSL', process.env.DATABASE_SSL === 'true', 'must be true for hosted PostgreSQL');
record('API_AUTH_REQUIRED', process.env.API_AUTH_REQUIRED === 'true', 'must be true for TestFlight');
record('API_REQUIRE_DATABASE', process.env.API_REQUIRE_DATABASE === 'true', 'must be true for TestFlight');
record('API_HOST', (process.env.API_HOST ?? '0.0.0.0') === '0.0.0.0', 'must bind all interfaces');
record('API_SESSION_SECRET length', Buffer.byteLength(process.env.API_SESSION_SECRET ?? '') >= 32, 'at least 32 bytes');
record(
  'STELLAR_SETTLEMENT_CONTRACT_ID format',
  /^[C][A-Z2-7]{55}$/.test(process.env.STELLAR_SETTLEMENT_CONTRACT_ID ?? ''),
  'valid contract address',
);
record(
  'STELLAR_WALLET_WASM_HASH format',
  /^[a-f0-9]{64}$/i.test(process.env.STELLAR_WALLET_WASM_HASH ?? ''),
  '64 hexadecimal characters',
);

const failed = checks.filter(check => !check.ok);
console.log(JSON.stringify({ok: failed.length === 0, checks}, null, 2));
if (failed.length > 0) process.exitCode = 1;

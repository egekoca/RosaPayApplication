type LogMetadata = Record<string, unknown>;
const blockedKeys = /secret|signature|authorization|credential|biometric/i;

function redact(metadata: LogMetadata): LogMetadata {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, blockedKeys.test(key) ? '[REDACTED]' : value]),
  );
}

export const logger = {
  info(event: string, metadata: LogMetadata = {}) {
    console.info(JSON.stringify({level: 'info', event, ...redact(metadata)}));
  },
  error(event: string, metadata: LogMetadata = {}) {
    console.error(JSON.stringify({level: 'error', event, ...redact(metadata)}));
  },
};

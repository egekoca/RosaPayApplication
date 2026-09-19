import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';
export {PostgresEventCursorStore} from './PostgresEventCursorStore';

const config = createStellarConfig(process.env.STELLAR_NETWORK ?? 'testnet', {
  rpcUrl: process.env.STELLAR_RPC_URL,
  settlementContractId: process.env.STELLAR_SETTLEMENT_CONTRACT_ID,
});
const health = await new StellarRpcClient(config).health();
console.info(JSON.stringify({level: 'info', event: 'worker_stellar_ready', ...health}));

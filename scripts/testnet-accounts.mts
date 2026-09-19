/**
 * Reports what the Testnet demo accounts hold, and tops up whatever is short.
 *
 * Testing the app end to end needs three funded things: a relayer with enough
 * XLM to pay fees, an admin that can register merchants, and a merchant with a
 * receiving account that exists on the ledger. Friendbot creates and funds an
 * account in one call, so an account that has never been used and one that has
 * run dry are handled the same way.
 *
 * Device wallets are deliberately not topped up here. They are provisioned and
 * funded by the API the first time a customer pays on Testnet, and funding one
 * by hand would hide a broken provisioning path.
 */
import {readFileSync} from 'node:fs';
import {createStellarConfig, readNativeBalance} from '@rosapay/stellar';

const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
/** Below this an account cannot pay fees for a demo session with room to spare. */
const MINIMUM_XLM = 100;

type Account = {
  label: string;
  address: string;
  purpose: string;
};

async function nativeBalance(address: string): Promise<number | null> {
  if (address.startsWith('C')) {
    const balance = await readNativeBalance(createStellarConfig('testnet'), address);
    return Number(balance);
  }
  const response = await fetch(`${HORIZON}/accounts/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Horizon returned ${response.status} for ${address}`);
  const body = (await response.json()) as {balances: Array<{asset_type: string; balance: string}>};
  return Number(body.balances.find(balance => balance.asset_type === 'native')?.balance ?? '0');
}

async function fund(address: string): Promise<boolean> {
  const response = await fetch(`${FRIENDBOT}?addr=${address}`);
  if (response.ok) return true;
  // Friendbot refuses an account it funded recently; that is not a failure worth
  // stopping for, because the account already exists.
  const body = await response.text();
  return body.includes('op_already_exists') || body.includes('createAccountAlreadyExist');
}

async function main() {
  const deployment = JSON.parse(
    readFileSync(new URL('../config/testnet-deployment.json', import.meta.url), 'utf8'),
  ) as {adminAddress: string};
  const evidence = JSON.parse(
    readFileSync(new URL('../config/testnet-hardware-wallet-evidence.json', import.meta.url), 'utf8'),
  ) as {relayer: string; merchantRecipient: string; walletContractId: string};
  const relayed = JSON.parse(
    readFileSync(new URL('../config/testnet-relayed-evidence.json', import.meta.url), 'utf8'),
  ) as {customer: string};

  const accounts: Account[] = [
    {label: 'admin', address: deployment.adminAddress, purpose: 'registers merchants on the contract'},
    {label: 'relayer', address: evidence.relayer, purpose: 'pays every settlement fee'},
    {label: 'merchant', address: evidence.merchantRecipient, purpose: 'receives what customers pay'},
    {label: 'customer', address: relayed.customer, purpose: 'the scripted end-to-end customer'},
  ];

  console.log('Testnet demo accounts\n');
  let toppedUp = 0;

  for (const account of accounts) {
    const before = await nativeBalance(account.address);
    const short = before === null || before < MINIMUM_XLM;

    if (short) {
      const funded = await fund(account.address);
      const after = funded ? await nativeBalance(account.address) : before;
      toppedUp += 1;
      console.log(
        `  ${account.label.padEnd(9)} ${account.address}`,
        `\n            ${before === null ? 'did not exist' : `${before} XLM`} -> ${after ?? 'still missing'} XLM  (${account.purpose})`,
      );
      continue;
    }

    console.log(`  ${account.label.padEnd(9)} ${account.address}\n            ${before} XLM  (${account.purpose})`);
  }

  const wallet = await nativeBalance(evidence.walletContractId).catch(() => null);
  console.log(
    `\n  device wallet ${evidence.walletContractId}`,
    `\n            ${wallet === null ? 'not provisioned' : `${wallet} XLM`}  (the API funds this on the first Testnet payment)`,
  );

  console.log(
    toppedUp === 0
      ? '\nEvery account has enough to run a demo session.'
      : `\nTopped up ${toppedUp} account(s) from friendbot.`,
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

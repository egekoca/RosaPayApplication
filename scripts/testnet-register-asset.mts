/**
 * Registers an asset the settlement contract will accept, and proves it took.
 *
 * The contract refuses any token it was not told about, which is what stops a
 * merchant being paid in something worthless that happens to implement the
 * token interface. Adding one is therefore an admin action on chain, not a
 * config flag — and this script is how it is done, so the reason and the
 * resulting transaction are both on the record.
 *
 * Reads STELLAR_ADMIN_SECRET. Run with:
 *   npm run testnet:register-asset -- USDC GBBD47IF…FLA5
 *   npm run testnet:register-asset -- --list
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  Address,
  StrKey,
} from '@stellar/stellar-sdk';

const deploymentUrl = new URL('../config/testnet-deployment.json', import.meta.url);
const deployment = JSON.parse(readFileSync(deploymentUrl, 'utf8')) as {
  rpcUrl: string;
  networkPassphrase: string;
  settlementContractId: string;
  adminAddress: string;
  registeredAssets?: Array<{code: string; issuer?: string; contractId: string; registeredAt: string; transactionHash: string}>;
};

const server = new rpc.Server(deployment.rpcUrl);

/** What the contract stores under `SupportedAsset(address)`, or false if absent. */
async function isSupported(contractId: string): Promise<boolean> {
  const key = nativeToScVal(
    [nativeToScVal('SupportedAsset', {type: 'symbol'}), new Address(contractId).toScVal()],
    {type: 'vec'},
  );
  const entry = await server
    .getContractData(deployment.settlementContractId, key, rpc.Durability.Persistent)
    .catch(() => null);
  if (!entry) return false;
  return scValToNative(entry.val.contractData().val()) === true;
}

async function register(code: string, issuer: string | undefined): Promise<void> {
  const asset = issuer ? new Asset(code, issuer) : Asset.native();
  const contractId = asset.contractId(deployment.networkPassphrase);

  console.log(`asset      ${code}${issuer ? ` issued by ${issuer}` : ' (native)'}`);
  console.log(`SAC        ${contractId}`);

  if (await isSupported(contractId)) {
    console.log('already registered — nothing to do\n');
    return;
  }

  const secret = process.env.STELLAR_ADMIN_SECRET;
  if (!secret) throw new Error('Set STELLAR_ADMIN_SECRET to the contract admin');
  const admin = Keypair.fromSecret(secret);
  if (admin.publicKey() !== deployment.adminAddress) {
    // Registering from the wrong key fails inside the contract, which reads as
    // an opaque simulation error rather than "you used the wrong secret".
    throw new Error(
      `STELLAR_ADMIN_SECRET is ${admin.publicKey()}, but the contract admin is ${deployment.adminAddress}`,
    );
  }

  const account = await server.getAccount(admin.publicKey());
  const built = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: deployment.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: deployment.settlementContractId,
        function: 'register_asset',
        args: [new Address(contractId).toScVal(), nativeToScVal(true, {type: 'bool'})],
      }),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(built);
  prepared.sign(admin);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`Submission refused: ${JSON.stringify(sent.errorResult)}`);
  }

  const receipt = await server.pollTransaction(sent.hash, {attempts: 20});
  if (receipt.status !== 'SUCCESS') {
    throw new Error(`register_asset did not succeed: ${receipt.status}`);
  }

  console.log(`registered in ledger ${receipt.ledger}`);
  console.log(`tx         ${sent.hash}`);
  console.log(`           https://stellar.expert/explorer/testnet/tx/${sent.hash}\n`);

  const registered = deployment.registeredAssets ?? [];
  registered.push({
    code,
    ...(issuer ? {issuer} : {}),
    contractId,
    registeredAt: new Date().toISOString(),
    transactionHash: sent.hash,
  });
  writeFileSync(
    deploymentUrl,
    `${JSON.stringify({...deployment, registeredAssets: registered}, null, 2)}\n`,
  );
}

async function list(): Promise<void> {
  // Re-read: a registration in this same run has already rewritten the file,
  // and the copy loaded at import time still says there is nothing.
  const current = JSON.parse(readFileSync(deploymentUrl, 'utf8')) as typeof deployment;
  console.log(`settlement ${current.settlementContractId}\n`);
  for (const asset of current.registeredAssets ?? []) {
    const live = await isSupported(asset.contractId);
    console.log(
      `  ${asset.code.padEnd(6)} ${asset.contractId}  ${live ? 'accepted' : 'NOT accepted on chain'}`,
    );
  }
  if (!current.registeredAssets?.length) console.log('  (none recorded)');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--list' || args.length === 0) {
    await list();
    return;
  }

  const [code, issuer] = args;
  if (!code) throw new Error('Usage: testnet:register-asset -- <CODE> [ISSUER]');
  if (issuer && !StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error(`${issuer} is not a Stellar account address`);
  }
  await register(code, issuer);
  await list();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

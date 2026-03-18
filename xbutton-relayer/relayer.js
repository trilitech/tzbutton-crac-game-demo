import 'dotenv/config';
import { ethers } from 'ethers';

const {
  EVM_RPC,
  RELAYER_PRIVATE_KEY,
  POT_ADDRESS,
  GAME_KT1,
  CRAC_PRECOMPILE,
  TEZLINK_RPC,
} = process.env;

if (!EVM_RPC || !RELAYER_PRIVATE_KEY || !POT_ADDRESS || !GAME_KT1 || !CRAC_PRECOMPILE || !TEZLINK_RPC) {
  throw new Error('Missing required env vars (EVM_RPC, RELAYER_PRIVATE_KEY, POT_ADDRESS, GAME_KT1, CRAC_PRECOMPILE, TEZLINK_RPC)');
}

const tezlinkStorageUrl = `${TEZLINK_RPC}/chains/main/blocks/head/context/contracts/${GAME_KT1}/storage`;

const provider = new ethers.JsonRpcProvider(EVM_RPC);
const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);

const START_BLOCK_LOOKBACK = 20;
const POLL_INTERVAL_MS = 5000;

const escrowAbi = [
  'event Deposited(address indexed player, uint256 amount)',
  'event PaidOut(address indexed winner, uint256 amount)',
  'function payout(address winner, uint256 amount)',
];
const gatewayAbi = [
  'function callMichelson(string destination, string entrypoint, bytes data) external payable',
];

const escrow = new ethers.Contract(POT_ADDRESS, escrowAbi, provider);
const escrowWithWallet = new ethers.Contract(POT_ADDRESS, escrowAbi, wallet);
const gateway = new ethers.Contract(CRAC_PRECOMPILE, gatewayAbi, wallet);

const processed = new Set();
let payoutSent = false;

// Gas limit for CRAC callMichelson (same as other entrypoint calls to avoid estimation issues)
const CRAC_GAS_LIMIT = 2_000_000n;

// Unit parameter for mark_paid entrypoint (takes unit in Ligo).
// Raw Micheline (no PACK prefix) — matches how the frontend sends unit for claim: 03=prim, 0b=D_Unit.
const UNIT_BYTES = '0x030b';

// ---------------------------------------------------------------------------
// Tezlink storage fetch and parse
// ---------------------------------------------------------------------------

async function fetchStorage() {
  const response = await fetch(tezlinkStorageUrl);
  if (!response.ok) {
    throw new Error(`Tezlink storage fetch failed: ${response.status}`);
  }
  return response.json();
}

function parseStorage(storage) {
  // storage: (pair last_player (pair pot (pair session_end (pair claim_requested payout_completed))))
  const lastPlayer = storage?.args?.[0]?.bytes;
  const pot = storage?.args?.[1]?.args?.[0]?.int;
  const claimedPrim = storage?.args?.[1]?.args?.[1]?.args?.[1]?.args?.[0]?.prim;
  const payoutCompletedPrim = storage?.args?.[1]?.args?.[1]?.args?.[1]?.args?.[1]?.prim;
  return {
    lastPlayer: lastPlayer ?? null,
    pot: pot ?? null,
    claimed: claimedPrim === 'True',
    payoutCompleted: payoutCompletedPrim === 'True',
  };
}

async function checkClaimAndPayout() {
  let storage;
  try {
    storage = await fetchStorage();
  } catch (err) {
    console.error('Storage fetch error:', err.message);
    return;
  }

  const { lastPlayer, pot, claimed, payoutCompleted } = parseStorage(storage);

  if (!claimed) return;
  if (payoutCompleted) return;
  if (!lastPlayer || !pot) {
    console.error('Storage parse: missing lastPlayer or pot');
    return;
  }

  const winner = '0x' + lastPlayer;
  const amount = BigInt(pot);

  if (lastPlayer.length !== 40) {
    console.error('Invalid last_player bytes length:', lastPlayer.length);
    return;
  }

  console.log('[relayer] Winner detected:', winner);
  console.log('[relayer] Amount:', amount.toString());

  // Check if the escrow already emitted PaidOut for this winner (e.g. previous run, within last 999 blocks).
  const existingPayoutTx = await checkAlreadyPaidOut(winner);
  if (existingPayoutTx || payoutSent) {
    console.log('[relayer] Payout already on-chain (tx:', existingPayoutTx ?? 'this run', '); skipping — calling mark_paid to sync Tezos.');
    await callMarkPaid();
    return;
  }

  try {
    const tx = await escrowWithWallet.payout(winner, amount);
    console.log('[relayer] Payout tx:', tx.hash);
    await tx.wait();
    payoutSent = true;
    console.log('[relayer] Winner paid!');
    await callMarkPaid();
  } catch (err) {
    const revertReason = decodeRevertReason(err);
    if (revertReason && revertReason.toLowerCase().includes('balance too low')) {
      // Escrow balance is zero — payout was already sent in a previous run.
      // Set payoutSent so we don't retry payout, then sync Tezos via mark_paid.
      payoutSent = true;
      console.log('[relayer] Escrow balance is zero — payout was already sent. Calling mark_paid to sync Tezos.');
      await callMarkPaid();
    } else if (revertReason) {
      console.error('[relayer] Payout revert reason:', revertReason);
    } else {
      console.error('[relayer] Payout failed:', err.shortMessage ?? err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Manual Micheline binary encoding
// Micheline binary format (no PACK 0x05 prefix — gateway wants raw expression)
//
// Pair tag        = 0x07
// Bytes tag       = 0x0a  followed by 4-byte big-endian length then raw bytes
// Int/Nat tag     = 0x00  followed by zarith-encoded unsigned integer
//
// So Pair(Bytes(addr), Int(amount)) encodes as:
//   07 07          <- Prim Pair with 2 args
//   0a <len4> <20 bytes>   <- Bytes node
//   00 <zarith>    <- Int node
// ---------------------------------------------------------------------------

function michelineIntEncode(value) {
  let n = BigInt(value);
  if (n < 0n) {
    throw new Error('Only non-negative values supported for nat');
  }

  const bytes = [];

  // First byte carries 6 payload bits, then continuation bits use 7-bit groups.
  let first = Number(n & 0x3fn);
  n >>= 6n;

  if (n > 0n) first |= 0x80;
  bytes.push(first);

  while (n > 0n) {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    bytes.push(b);
  }

  return Buffer.from(bytes);
}

function encodeRecordDeposit(playerEvmAddress, amount) {
  const addrHex = playerEvmAddress.toLowerCase().replace(/^0x/, '');
  if (addrHex.length !== 40) {
    throw new Error(`Bad EVM address: ${playerEvmAddress}`);
  }

  const addrBytes = Buffer.from(addrHex, 'hex');
  const amountBytes = michelineIntEncode(amount);

  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(addrBytes.length);

  const encoded = Buffer.concat([
    Buffer.from([0x07, 0x07]), // Pair
    Buffer.from([0x0a]), // bytes
    lenBuf,
    addrBytes,
    Buffer.from([0x00]), // int
    amountBytes,
  ]);

  return `0x${encoded.toString('hex')}`;
}

function decodeRevertReason(err) {
  // Try multiple paths CRAC / ethers may use for the revert payload.
  const candidates = [
    err?.info?.error?.data,
    err?.data,
    err?.error?.data,
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string' || !raw.startsWith('0x')) continue;
    try {
      const text = Buffer.from(raw.slice(2), 'hex').toString('utf8').replace(/\0/g, '').trim();
      if (text) return text;
    } catch { /* ignore */ }
    return raw; // return raw hex if UTF-8 fails
  }
  return null;
}

// Check the escrow for a PaidOut(winner, amount) event — used to avoid double-paying.
// Looks back at most MAX_LOG_WINDOW blocks to stay within the RPC limit.
const MAX_LOG_WINDOW = 999;

async function checkAlreadyPaidOut(winner) {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - MAX_LOG_WINDOW);
    const byWinner = await escrow.queryFilter(escrow.filters.PaidOut(winner), fromBlock, 'latest');
    if (byWinner.length > 0) {
      return byWinner[byWinner.length - 1].transactionHash ?? null;
    }
    const all = await escrow.queryFilter(escrow.filters.PaidOut(), fromBlock, 'latest');
    if (all.length > 0) {
      return all[all.length - 1].transactionHash ?? null;
    }
  } catch (err) {
    console.error('[relayer] PaidOut query failed:', err.message);
  }
  return null;
}

async function callMarkPaid() {
  console.log('[relayer] Sending mark_paid with UNIT bytes:', UNIT_BYTES);

  try {
    const tx = await gateway.callMichelson(
      GAME_KT1,
      'mark_paid',
      UNIT_BYTES,
      { gasLimit: CRAC_GAS_LIMIT }
    );

    console.log('[relayer] mark_paid CRAC tx sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('[relayer] mark_paid confirmed in block:', receipt.blockNumber);
  } catch (markPaidErr) {
    const reason = decodeRevertReason(markPaidErr);
    if (reason) {
      console.error('[relayer] mark_paid revert reason:', reason);
    } else {
      // Log raw error data so we can diagnose encoding or permission issues.
      const raw = markPaidErr?.info?.error?.data ?? markPaidErr?.data ?? null;
      if (raw) console.error('[relayer] mark_paid raw revert data:', raw);
    }
    console.error('[relayer] mark_paid failed:', markPaidErr.shortMessage ?? markPaidErr.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processDeposited(log) {
  const key = `${log.transactionHash}:${log.index}`;
  if (processed.has(key)) return;
  processed.add(key);

  const parsed = escrow.interface.parseLog(log);
  const { player, amount } = parsed.args;

  console.log('[relayer] Deposit', { player, amount: amount.toString(), tx: log.transactionHash });

  try {
    const encodedBytes = encodeRecordDeposit(player, amount);
    const tx = await gateway.callMichelson(
      GAME_KT1,
      'record_deposit',
      encodedBytes,
      { gasLimit: CRAC_GAS_LIMIT }
    );
    await tx.wait();
    console.log('[relayer] record_deposit ok', tx.hash);
  } catch (err) {
    const revertReason = decodeRevertReason(err);
    console.error('[relayer] record_deposit failed:', revertReason ?? err.shortMessage ?? err.message);
  }
}

async function pollDeposits() {
  const latestBlock = await provider.getBlockNumber();
  let fromBlock = Math.max(0, latestBlock - START_BLOCK_LOOKBACK);
  console.log('[relayer] Deposited scan from block', fromBlock);

  const filter = escrow.filters.Deposited();

  while (true) {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock >= fromBlock) {
        const logs = await escrow.queryFilter(filter, fromBlock, currentBlock);
        for (const log of logs) {
          await processDeposited(log);
        }
        fromBlock = currentBlock + 1;
      }

      await checkClaimAndPayout();
    } catch (err) {
      console.error('Polling error:', err.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  console.log('Relayer wallet:', wallet.address);
  console.log('Watching escrow Deposited events at:', POT_ADDRESS);
  console.log('Game KT1:', GAME_KT1);
  console.log('Tezlink storage:', tezlinkStorageUrl);
  console.log('Payout: will call escrow.payout(winner, amount) when claimed=true');

  await pollDeposits();
}

main().catch(console.error);


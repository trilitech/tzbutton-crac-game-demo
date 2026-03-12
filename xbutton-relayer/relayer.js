import 'dotenv/config';
import { ethers } from 'ethers';

const {
  EVM_RPC,
  RELAYER_PRIVATE_KEY,
  USDC_ADDRESS,
  POT_ADDRESS,
  GAME_KT1,
  CRAC_PRECOMPILE,
} = process.env;

if (!EVM_RPC || !RELAYER_PRIVATE_KEY || !USDC_ADDRESS || !POT_ADDRESS || !GAME_KT1 || !CRAC_PRECOMPILE) {
  throw new Error('Missing required env vars');
}

const provider = new ethers.JsonRpcProvider(EVM_RPC);
const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const potAddressLower = POT_ADDRESS.toLowerCase();

const START_BLOCK_LOOKBACK = 20;
const POLL_INTERVAL_MS = 5000;

const usdcAbi = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
const gatewayAbi = [
  'function call(string destination, string entrypoint, bytes data) external payable',
];

const usdc = new ethers.Contract(USDC_ADDRESS, usdcAbi, provider);
const gateway = new ethers.Contract(CRAC_PRECOMPILE, gatewayAbi, wallet);

const processed = new Set();

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
  const revertData = err?.info?.error?.data;
  if (!revertData || !revertData.startsWith('0x')) {
    return null;
  }

  try {
    return Buffer.from(revertData.slice(2), 'hex').toString('utf8');
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processTransfer(log) {
  const key = `${log.transactionHash}:${log.index}`;
  if (processed.has(key)) return;
  processed.add(key);

  const parsed = usdc.interface.parseLog(log);
  const { from, to, value } = parsed.args;

  if (to.toLowerCase() !== potAddressLower) return;

  console.log('Deposit detected', {
    from,
    to,
    value: value.toString(),
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  });

  try {
    const encodedBytes = encodeRecordDeposit(from, value);
    console.log('Micheline bytes:', encodedBytes);

    const tx = await gateway.call(GAME_KT1, 'record_deposit', encodedBytes);
    console.log('CRAC tx sent:', tx.hash);

    const receipt = await tx.wait();
    console.log('CRAC confirmed in block:', receipt.blockNumber);
  } catch (err) {
    const revertReason = decodeRevertReason(err);
    if (revertReason) {
      console.error('Revert reason:', revertReason);
    }

    console.error('CRAC call failed:', err.shortMessage ?? err.message);
  }
}

async function pollTransfers() {
  const latestBlock = await provider.getBlockNumber();
  let fromBlock = Math.max(0, latestBlock - START_BLOCK_LOOKBACK);
  console.log('Starting from block:', fromBlock);

  const filter = usdc.filters.Transfer(null, POT_ADDRESS);

  while (true) {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock >= fromBlock) {
        const logs = await usdc.queryFilter(filter, fromBlock, currentBlock);
        for (const log of logs) {
          await processTransfer(log);
        }
        fromBlock = currentBlock + 1;
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  console.log('Relayer wallet:', wallet.address);
  console.log('Watching USDC transfers to:', POT_ADDRESS);
  console.log('USDC contract:', USDC_ADDRESS);
  console.log('Game KT1:', GAME_KT1);

  await pollTransfers();
}

main().catch(console.error);
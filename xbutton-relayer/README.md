# XButton Relayer

Node.js relayer for the Tezos X / CRAC XButton demo.

## What It Does

- Watches the **escrow** (`POT_ADDRESS`) for `Deposited` events.
- Encodes `(player, amount)` as Micheline and calls CRAC `callMichelson` → `record_deposit` on the game KT1.
- When Tezlink storage shows `claim_requested` and not yet `payout_completed`, calls `escrow.payout(winner, pot)` then `mark_paid` (unit param `0x030b`) via CRAC.
- Uses **`PaidOut` logs** (last ~999 blocks, RPC limit) to skip duplicate payouts after restarts.

Without the relayer, deposits do not update Tezos storage and winners are not paid.

## Escrow & token

Deploy from **`../contracts/evm`**: `xUSDC.sol`, then `xEscrow.sol` with `_authorizedCaller` = relayer EVM address. See **`../contracts/tezlink`** for the game contract.

## Environment

```bash
EVM_RPC=...
TEZLINK_RPC=.../tezlink
RELAYER_PRIVATE_KEY=0x...
USDC_ADDRESS=0x...
POT_ADDRESS=0x...
GAME_KT1=KT1...
CRAC_PRECOMPILE=0xff00000000000000000000000000000000000007
```

## Run

```bash
cd xbutton-relayer && npm install && npm run dev
```

## Related

- `../contracts/tezlink` — LIGO / Michelson game contract
- `../xbutton-frontend` — MetaMask UI
- `../README.md` — workspace overview

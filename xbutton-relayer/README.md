# XButton Relayer

Node.js relayer for the Tezos X / CRAC XButton demo.

## What It Does

This process bridges the EVM-side deposit into the Tezos runtime.

It:
- watches the USDC contract for `Transfer` events to the pot address
- extracts the sender and amount from the EVM event
- encodes `(player, amount)` into raw Micheline bytes
- calls the CRAC gateway precompile
- targets the `record_deposit` entrypoint on the Tezos contract

Without this relayer running, the frontend can still send `1 USDC` to the pot, but the Tezos-side storage will not update.

## Environment Variables

Create a `.env` file with:

```bash
EVM_RPC=https://demo.txpark.nomadic-labs.com/rpc
RELAYER_PRIVATE_KEY=0x...
USDC_ADDRESS=0x92E791DF3Dd5A8704f0e7d9B3003A0627d95d017
POT_ADDRESS=0xA8D4F48e9E5a17e13Bfbe3A60bbEd85b96552277
GAME_KT1=KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS
CRAC_PRECOMPILE=0xff00000000000000000000000000000000000007
```

## Run Locally

```bash
cd /Users/adebolaadeniran/Documents/tezosx/xbutton-relayer
npm install
npm run dev
```

This runs:

```bash
node relayer.js
```

## Expected Runtime Flow

1. A player sends USDC to `POT_ADDRESS`.
2. The relayer detects the `Transfer` log.
3. The relayer encodes the EVM address and amount into Micheline bytes.
4. The relayer calls `CRAC_PRECOMPILE`.
5. The Tezos-side contract `record_deposit` entrypoint updates storage.

## Related Folders

- `../xbutton-frontend` triggers the deposit from the browser
- `../tezosx-tezlink` contains the Tezos contract logic
- `../README.md` explains the end-to-end workspace flow

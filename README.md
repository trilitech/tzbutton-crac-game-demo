# TezosX Workspace

This workspace contains the pieces used for the Tezos X / CRAC XButton demo.

## What Each Folder Does

### `xbutton-frontend`

Small React + Vite frontend for the XButton demo.

It:
- connects MetaMask
- shows EVM wallet and network status
- polls Tezlink storage from the Michelson contract
- sends `1 USDC` to the pot address
- waits for the Tezos-side game state to update

### `xbutton-relayer`

Node.js relayer that watches EVM USDC transfers to the pot address and forwards them into the Tezos runtime through the CRAC gateway precompile.

It:
- listens for ERC-20 `Transfer` events to the pot
- encodes raw Micheline bytes
- calls the CRAC precompile
- triggers `record_deposit` on the Michelson contract

### `tezosx-tezlink`

The CameLIGO / Michelson contract source for the XButton game logic.

It stores:
- admin
- last player
- pot
- session end
- claimed flag

## XButton Demo Flow

1. A player connects MetaMask in `xbutton-frontend`.
2. The player presses the button, which sends `1 USDC` to the pot address on the EVM runtime.
3. `xbutton-relayer` detects the ERC-20 transfer event.
4. The relayer encodes the payload and calls the CRAC gateway precompile.
5. The Tezos runtime contract in `tezosx-tezlink` updates storage.
6. `xbutton-frontend` polls Tezlink and shows the updated pot / player state.

## Shared Live Demo Values

These are the values currently used in the workspace:

- EVM RPC: `https://demo.txpark.nomadic-labs.com/rpc`
- Tezlink RPC: `https://demo.txpark.nomadic-labs.com/rpc/tezlink`
- Chain ID: `127124`
- USDC token: `0x92E791DF3Dd5A8704f0e7d9B3003A0627d95d017`
- Pot address: `0xA8D4F48e9E5a17e13Bfbe3A60bbEd85b96552277`
- Michelson contract: `KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS`
- CRAC precompile: `0xff00000000000000000000000000000000000007`

## Get Testnet USDC

Before using the XButton demo, fund your wallet with testnet USDC on TezosX EVM using the hosted faucet:

- [https://tezosx-evm-usdc-airdrop.vercel.app/](https://tezosx-evm-usdc-airdrop.vercel.app/)

Use that app to send testnet USDC to the same MetaMask wallet you will use in `xbutton-frontend`.

## Running The XButton Demo

From the workspace root:

```bash
cd /Users/adebolaadeniran/Documents/tezosx
npm install
npm run dev
```

That starts:
- `xbutton-frontend`
- `xbutton-relayer`

## Important Notes

- The relayer is separate from the frontend. If the relayer is not running, the Tezos-side pot will not update.
- The contract session must be active before deposits will update state.
- The frontend has hardcoded demo values at the moment, based on the addresses already in this workspace.
- `evm-airdrop-app` exists locally in the workspace, but it is intentionally excluded from this root repository.
- Each project folder contains its own README with more detail.

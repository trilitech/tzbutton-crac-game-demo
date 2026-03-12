# XButton Frontend

Minimal React + Vite frontend for the Tezos X / CRAC XButton demo.

## What It Does

- connects MetaMask
- shows wallet and network status
- polls Tezlink storage every 5 seconds
- displays live game state from the Michelson contract
- sends `1 USDC` to the EVM pot address
- waits for the Tezos-side game storage to update after the EVM transfer

## What It Does Not Do

- it does not update Tezos storage by itself
- it does not replace the relayer
- it does not run any backend

The frontend only sends the ERC-20 transfer. The relayer is what notices that transfer and calls the CRAC precompile.

## Live Values Used

- EVM RPC: `https://demo.txpark.nomadic-labs.com/rpc`
- Tezlink RPC: `https://demo.txpark.nomadic-labs.com/rpc/tezlink`
- Chain ID: `127124`
- USDC token: `0x92E791DF3Dd5A8704f0e7d9B3003A0627d95d017`
- Pot address: `0xA8D4F48e9E5a17e13Bfbe3A60bbEd85b96552277`
- Game contract: `KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS`

## Run Locally

```bash
cd /Users/adebolaadeniran/Documents/tezosx/xbutton-frontend
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

## Demo Requirements

- MetaMask installed
- MetaMask connected to the TezosX EVM network
- chain ID set to `127124`
- a wallet with enough `USDC` to send `1 USDC`
- the relayer running in `xbutton-relayer`
- an active session on the Tezos contract

If your wallet needs testnet USDC first, use the hosted faucet:

- [https://tezosx-evm-usdc-airdrop.vercel.app/](https://tezosx-evm-usdc-airdrop.vercel.app/)

## Related Folders

- `../xbutton-relayer` handles the EVM-to-Tezos forwarding
- `../tezosx-tezlink` contains the contract source
- `../README.md` explains the full workspace flow

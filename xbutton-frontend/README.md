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

## Configuration

Copy `.env.example` to `.env` and adjust as needed. All values use the `VITE_` prefix.

- `VITE_EVM_RPC` – EVM RPC URL
- `VITE_TEZLINK_RPC` – Tezlink RPC URL
- `VITE_CHAIN_ID` – Chain ID (e.g. `127124`)
- `VITE_USDC_ADDRESS` – USDC token address
- `VITE_POT_ADDRESS` – Pot address
- `VITE_GAME_CONTRACT` – Michelson contract address

## Run Locally

```bash
cd /Users/adebolaadeniran/Documents/tezosx/xbutton-frontend
cp .env.example .env   # if .env doesn't exist
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

If your wallet needs testnet USDC first, use the hosted TezosX EVM faucet: [https://tezosx-evm-usdc-airdrop.vercel.app/](https://tezosx-evm-usdc-airdrop.vercel.app/) (override via `VITE_FAUCET_URL` if needed).

## Related Folders

- `../xbutton-relayer` handles the EVM-to-Tezos forwarding
- `../contracts/tezlink` contains the Tezos game contract source
- `../README.md` explains the full workspace flow

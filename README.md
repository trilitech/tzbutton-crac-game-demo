# TezosX Workspace

Demo pieces for the Tezos X / CRAC XButton flow: EVM deposits, relayer → Tezlink, Michelson game state.

**Testnet funds:** Hosted faucet for TezosX EVM (USDC / XTZ): **[https://tezosx-evm-usdc-airdrop.vercel.app/](https://tezosx-evm-usdc-airdrop.vercel.app/)** — use the same wallet you use in the demo frontend.

## Layout

| Area | Role |
|------|------|
| **Frontend** | React + Vite: MetaMask, Tezlink polling, USDC to escrow, CRAC calls. |
| **Relayer** | Node: watches escrow `Deposited` events, Micheline payload, CRAC `callMichelson` → `record_deposit`. |
| **Contracts** | EVM (`xUSDC`, `xEscrow`) under `contracts/evm`; Tezlink game (LIGO / Michelson) under `contracts/tezlink`. |

## Demo flow

1. Connect a wallet in the frontend on the TezosX EVM network.
2. Approve/deposit **1 USDC** to the configured escrow (pot) address.
3. The relayer sees the deposit and forwards it through the CRAC precompile.
4. The Michelson contract updates **pot** / **last player** (when the on-chain session is active).
5. The frontend polls Tezlink and shows live state.

## Example network values

Point `.env` at your deployment; defaults in the repo target the public demo RPCs:

- EVM RPC: `https://demo.txpark.nomadic-labs.com/rpc`
- Tezlink RPC: `https://demo.txpark.nomadic-labs.com/rpc/tezlink`
- Chain ID: `127124`
- Demo USDC / pot / `KT1` game contract — see each package’s `.env.example`; README values can drift.

## Tezos ↔ EVM address helpers

The EVM RPC exposes **`tez_getEthereumTezosAddress`** and **`tez_getTezosEthereumAddress`** (chain docs). The game’s `mark_paid` entrypoint is permissionless (claim-state only); CRAC does not map callers to a fixed Tezos `SENDER` for admin-style checks.

## Run locally

From the **root of your clone**:

```bash
npm install
npm run dev
```

That runs the frontend and relayer together (see root `package.json`). Configure env files in each app (see their `.env.example` files).

## Notes

- **Relayer must be running** or Tezlink state will not update after deposits.
- An **active session** on the game contract is required for `record_deposit` to apply.
- Override the default faucet link in the frontend via `VITE_FAUCET_URL` if you use another tap.
- **Start new session** / claim / payout flow is documented in **`contracts/tezlink/README.md`**.
- Subdirectories include their own READMEs for detail.

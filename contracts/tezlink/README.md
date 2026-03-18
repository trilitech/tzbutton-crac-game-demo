# XButton Tezlink Contract

This folder contains the **XButton game contract** for the Tezos runtime (Tezlink). It is used by the relayer (CRAC `record_deposit`, `mark_paid`) and the frontend (game state).

## Layout

| Folder    | Contents |
|----------|----------|
| **`ligo/`** | Contract source in CameLIGO (`xbutton.mligo`) and compiled Michelson (`xbutton.tz`). Compile contract and storage with Ligo, then originate with octez-client. |

## How it works

1. **Storage** — The contract holds:
   - `last_player` (bytes), `pot` (nat), `session_end` (timestamp), `claim_requested` (bool), `payout_completed` (bool).

2. **Entrypoints**
   - **`start_session(duration)`** — Callable by **anyone**. Resets pot, last player, session end, and claim flags (including abandoning an in-flight claim that has not been paid out yet — demo reset). Use from the frontend (“Start new session” via CRAC) or octez-client.
   - **`record_deposit(player, amount)`** — Called by the relayer via CRAC after an escrow `Deposited` event. Updates `last_player` and `pot`.
   - **`claim()`** — Callable by anyone; sets `claim_requested = true` so the relayer can run `escrow.payout(winner, amount)` and then `mark_paid`.
   - **`mark_paid()`** — Callable by anyone (guarded by `NO_CLAIM_REQUESTED` / `ALREADY_PAID`). Sets `payout_completed = true`.

3. **Init** — When originating you pass the initial storage (see step 2 below): `last_player`, `pot`, `session_end`, `claim_requested`, `payout_completed`.

Tezlink RPC: `https://demo.txpark.nomadic-labs.com/rpc/tezlink`

---

## Ligo folder (`ligo/`)

- **Source:** `xbutton.mligo`
- **Compiled:** `xbutton.tz`

### 1. Compile the contract

```bash
cd ligo
ligo compile contract xbutton.mligo -m XButton > xbutton.tz
```

### 2. Compile the initial storage

```bash
ligo compile storage xbutton.mligo \
  '{ last_player = 0x0000000000000000000000000000000000000000;
     pot = 0n;
     session_end = ("1970-01-01T00:00:00Z": timestamp);
     claim_requested = false;
     payout_completed = false }' \
  -m XButton
```

Copy the output; you will paste it as `--init` in the next step.

### 3. Originate with octez-client

From the **`ligo/`** directory (so `running xbutton.tz` resolves):

```bash
octez-client --endpoint https://demo.txpark.nomadic-labs.com/rpc/tezlink \
  originate contract xbutton_2 \
  transferring 0 from bootstrap1 \
  running xbutton.tz \
  --init '<PASTE_OUTPUT_OF_LIGO_COMPILE_STORAGE_HERE>' \
  --burn-cap 1
```

Replace `<PASTE_OUTPUT_OF_LIGO_COMPILE_STORAGE_HERE>` with the exact output from step 2.

### Start a session (after origination)

**Option A — From the frontend:** After the previous session **ends**, the “Start new session” button appears (even if no one claimed yet, or claim is pending payout). Click it to call `start_session` via CRAC from MetaMask.

**Option B — From octez-client (any key):**

```bash
octez-client --endpoint https://demo.txpark.nomadic-labs.com/rpc/tezlink \
  transfer 0 from tz1_ANY_KEY to <CONTRACT_ADDRESS> \
  --entrypoint start_session \
  --arg '3600' \
  --burn-cap 1
```

Replace `<CONTRACT_ADDRESS>` with your originated KT1. `3600` = 1 hour in seconds.

Set `GAME_KT1` in the frontend and relayer to the new contract address.

---

## Related

- **`../../xbutton-relayer`** — Calls `record_deposit` and `mark_paid` via CRAC; needs `GAME_KT1`.
- **`../../xbutton-frontend`** — Polls Tezlink storage, shows game state, and can start a new session via CRAC; needs `GAME_KT1`.
- **`../../README.md`** — Workspace overview.

# XButton Tezlink Contract

Contract source for the XButton game on the Tezos runtime.

Main source file:

- `xbutton.mligo`

## Storage Shape

The contract stores:

- `admin : address`
- `last_player : bytes`
- `pot : nat`
- `session_end : timestamp`
- `claimed : bool`

## Entrypoints

### `start_session`

Starts or refreshes a session window.

Only the admin can call this entrypoint.

### `record_deposit`

Accepts:

- `player : bytes`
- `amount : nat`

This is the entrypoint the relayer targets after an EVM USDC transfer is detected.

It updates:

- `last_player`
- `pot`

### `claim`

Marks the session as claimed after the session end.

## Current Contract

- Contract address: `KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS`
- Tezlink RPC: `https://demo.txpark.nomadic-labs.com/rpc/tezlink`

## Useful Commands

Compile the `start_session` parameter:

```bash
ligo compile parameter xbutton.mligo -m XButton 'Start_session(3600)'
```

Start a session with `octez-client`:

```bash
octez-client --endpoint https://demo.txpark.nomadic-labs.com/rpc/tezlink \
  transfer 0 from bootstrap1 to KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS \
  --arg '(Right (Right 3600))' \
  --burn-cap 1
```

## Related Folders

- `../xbutton-relayer` forwards EVM deposits to `record_deposit`
- `../xbutton-frontend` shows live state from Tezlink
- `../README.md` explains the whole workspace

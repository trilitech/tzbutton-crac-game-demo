module XButton = struct
  type storage = {
    last_player : bytes;
    pot : nat;
    session_end : timestamp;
    claim_requested : bool;
    payout_completed : bool;
  }

  type return_ = operation list * storage

  [@entry]
  let start_session (duration : int) (store : storage) : return_ =
    if store.claim_requested && not store.payout_completed then
      (failwith "PAYOUT_PENDING" : return_)
    else
      ([], {
        store with
        last_player = 0x0000000000000000000000000000000000000000;
        pot = 0n;
        session_end = Tezos.get_now () + duration;
        claim_requested = false;
        payout_completed = false
      })

  [@entry]
  let record_deposit ((player, amount) : bytes * nat) (store : storage) : return_ =
    if Tezos.get_now () > store.session_end then
      (failwith "SESSION_ENDED" : return_)
    else if store.claim_requested then
      (failwith "CLAIM_ALREADY_REQUESTED" : return_)
    else
      ([], {
        store with
        last_player = player;
        pot = store.pot + amount
      })

  [@entry]
  let claim (_u : unit) (store : storage) : return_ =
    if Tezos.get_now () < store.session_end then
      (failwith "SESSION_ACTIVE" : return_)
    else if store.claim_requested then
      (failwith "CLAIM_ALREADY_REQUESTED" : return_)
    else if store.pot = 0n then
      (failwith "EMPTY_POT" : return_)
    else
      ([], { store with claim_requested = true })

  [@entry]
  let mark_paid (_u : unit) (store : storage) : return_ =
    if not store.claim_requested then
      (failwith "NO_CLAIM_REQUESTED" : return_)
    else if store.payout_completed then
      (failwith "ALREADY_PAID" : return_)
    else
      ([], { store with payout_completed = true })
end

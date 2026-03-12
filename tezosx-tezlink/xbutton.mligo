module XButton = struct
  type storage = {
    admin : address;
    last_player : bytes;
    pot : nat;
    session_end : timestamp;
    claimed : bool;
  }

  type return_ = operation list * storage

  [@entry]
  let start_session (duration : int) (store : storage) : return_ =
    if Tezos.get_sender () <> store.admin then
      (failwith "NOT_ADMIN" : return_)
    else
      ([], { store with
        session_end = Tezos.get_now () + duration;
        claimed = false })

  [@entry]
  let record_deposit ((player, amount) : bytes * nat) (store : storage) : return_ =
    if Tezos.get_now () > store.session_end then
      (failwith "SESSION_ENDED" : return_)
    else
      ([], { store with
        last_player = player;
        pot = store.pot + amount })

  [@entry]
  let claim (_u : unit) (store : storage) : return_ =
    if Tezos.get_now () < store.session_end then
      (failwith "SESSION_ACTIVE" : return_)
    else if store.claimed then
      (failwith "ALREADY_CLAIMED" : return_)
    else
      ([], { store with claimed = true })
end

// Contract KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS
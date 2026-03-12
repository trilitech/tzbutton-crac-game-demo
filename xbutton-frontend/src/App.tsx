import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

const CONFIG = {
  appName: "XButton",
  evmRpc: "https://demo.txpark.nomadic-labs.com/rpc",
  tezlinkRpc: "https://demo.txpark.nomadic-labs.com/rpc/tezlink",
  tezlinkStorageUrl:
    "https://demo.txpark.nomadic-labs.com/rpc/tezlink/chains/main/blocks/head/context/contracts/KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS/storage",
  chainId: 127124n,
  chainIdHex: "0x1f094",
  usdcAddress: "0x92E791DF3Dd5A8704f0e7d9B3003A0627d95d017",
  potAddress: "0xA8D4F48e9E5a17e13Bfbe3A60bbEd85b96552277",
  gameContract: "KT1BKvMg5EWcv1TFMkvxo2zAAbUbUefh8EvS",
  usdcDecimals: 6,
  pressAmount: "1",
  pollIntervalMs: 5000,
} as const;

const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

const PRESS_AMOUNT_UNITS = ethers.parseUnits(CONFIG.pressAmount, CONFIG.usdcDecimals);

type TezlinkNode = {
  prim?: string;
  args?: TezlinkNode[];
  bytes?: string;
  int?: string;
};

type GameState = {
  adminBytes: string;
  lastPlayerBytes: string;
  lastPlayerAddress: string | null;
  potRaw: string;
  potDisplay: string;
  sessionEnd: number;
  claimed: boolean;
  fetchedAt: number;
};

type WalletState = {
  address: string | null;
  chainId: bigint | null;
  usdcBalance: string | null;
};

type ActionState =
  | { kind: "idle"; message: string; txHash?: undefined }
  | { kind: "pending"; message: string; txHash?: string }
  | { kind: "success"; message: string; txHash?: string }
  | { kind: "error"; message: string; txHash?: string };

type EthereumProvider = ethers.Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function getEthereum(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum as EthereumProvider | undefined;
}

function shortenAddress(value: string | null, size = 6) {
  if (!value) return "Not connected";
  return `${value.slice(0, size)}...${value.slice(-4)}`;
}

function formatTokenAmount(value: bigint, decimals: number) {
  const formatted = ethers.formatUnits(value, decimals);
  return formatted.replace(/\.?0+$/, "");
}

function formatMaybeEvmAddress(bytesValue: string) {
  if (bytesValue.length === 40) {
    return ethers.getAddress(`0x${bytesValue}`);
  }
  return null;
}

function parseGameStorage(storage: TezlinkNode): GameState {
  const levelOne = storage.args;
  const levelTwo = levelOne?.[1]?.args;
  const levelThree = levelTwo?.[1]?.args;
  const levelFour = levelThree?.[1]?.args;

  const adminBytes = levelOne?.[0]?.bytes;
  const lastPlayerBytes = levelTwo?.[0]?.bytes;
  const potRaw = levelThree?.[0]?.int;
  const sessionEndRaw = levelFour?.[0]?.int;
  const claimedPrim = levelFour?.[1]?.prim;

  if (!adminBytes || !lastPlayerBytes || !potRaw || !sessionEndRaw || !claimedPrim) {
    throw new Error("Unexpected Tezlink storage shape.");
  }

  return {
    adminBytes,
    lastPlayerBytes,
    lastPlayerAddress: formatMaybeEvmAddress(lastPlayerBytes),
    potRaw,
    potDisplay: formatTokenAmount(BigInt(potRaw), CONFIG.usdcDecimals),
    sessionEnd: Number(sessionEndRaw),
    claimed: claimedPrim === "True",
    fetchedAt: Date.now(),
  };
}

async function fetchGameState() {
  const response = await fetch(CONFIG.tezlinkStorageUrl);
  if (!response.ok) {
    throw new Error(`Tezlink RPC returned ${response.status}.`);
  }

  const json = (await response.json()) as TezlinkNode;
  return parseGameStorage(json);
}

async function sleep(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    chainId: null,
    usdcBalance: null,
  });
  const [isWalletDisconnected, setIsWalletDisconnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameStateError, setGameStateError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionState, setActionState] = useState<ActionState>({
    kind: "idle",
    message: "Connect MetaMask, then press the button to send 1 USDC to the pot.",
  });

  const hasMetaMask = typeof window !== "undefined" && Boolean(getEthereum());
  const onExpectedNetwork = walletState.chainId === CONFIG.chainId;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionActive = gameState ? gameState.sessionEnd > nowSeconds : true;
  const canPressButton =
    hasMetaMask &&
    Boolean(walletState.address) &&
    onExpectedNetwork &&
    !isSubmitting &&
    sessionActive &&
    !gameState?.claimed;

  const sessionLabel = useMemo(() => {
    if (!gameState) return "Loading...";
    return new Date(gameState.sessionEnd * 1000).toLocaleString();
  }, [gameState]);

  const refreshWalletState = useCallback(async (requestAccounts = false) => {
    if (isWalletDisconnected && !requestAccounts) {
      setWalletState({ address: null, chainId: null, usdcBalance: null });
      return;
    }

    const ethereum = getEthereum();
    if (!ethereum) {
      setWalletState({ address: null, chainId: null, usdcBalance: null });
      return;
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const accounts = (await provider.send(
      requestAccounts ? "eth_requestAccounts" : "eth_accounts",
      [],
    )) as string[];

    if (accounts.length === 0) {
      setWalletState({ address: null, chainId: null, usdcBalance: null });
      return;
    }

    const address = ethers.getAddress(accounts[0]);
    const network = await provider.getNetwork();
    const usdc = new ethers.Contract(CONFIG.usdcAddress, ERC20_ABI, provider);
    const balance = (await usdc.balanceOf(address)) as bigint;

    setWalletState({
      address,
      chainId: network.chainId,
      usdcBalance: formatTokenAmount(balance, CONFIG.usdcDecimals),
    });
  }, [isWalletDisconnected]);

  const refreshGameState = useCallback(async () => {
    try {
      const nextState = await fetchGameState();
      setGameState(nextState);
      setGameStateError(null);
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch game state.";
      setGameStateError(message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshWalletState(false);
    void refreshGameState();

    const intervalId = window.setInterval(() => {
      void refreshGameState();
    }, CONFIG.pollIntervalMs);

    const ethereum = getEthereum();
    if (!ethereum?.on) {
      return () => window.clearInterval(intervalId);
    }

    const handleAccountsChanged = () => {
      setIsWalletDisconnected(false);
      void refreshWalletState(false);
    };

    const handleChainChanged = () => {
      setIsWalletDisconnected(false);
      void refreshWalletState(false);
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.clearInterval(intervalId);
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshGameState, refreshWalletState]);

  async function connectWallet() {
    setWalletError(null);
    setIsConnecting(true);
    setIsWalletDisconnected(false);

    try {
      await refreshWalletState(true);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Failed to connect MetaMask.");
    } finally {
      setIsConnecting(false);
    }
  }

  function disconnectWallet() {
    setIsWalletDisconnected(true);
    setWalletError(null);
    setWalletState({ address: null, chainId: null, usdcBalance: null });
    setActionState({
      kind: "idle",
      message: "Wallet disconnected in the app. Reconnect MetaMask to press the button again.",
    });
  }

  async function switchNetwork() {
    const ethereum = getEthereum();
    if (!ethereum) return;

    try {
      await ethereum.request?.({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CONFIG.chainIdHex }],
      });
    } catch (error) {
      const switchError = error as { code?: number };

      if (switchError.code === 4902) {
        await ethereum.request?.({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CONFIG.chainIdHex,
              chainName: "TezosX EVM",
              rpcUrls: [CONFIG.evmRpc],
              nativeCurrency: {
                name: "XTZ",
                symbol: "XTZ",
                decimals: 18,
              },
            },
          ],
        });
      } else {
        throw error;
      }
    }

    await refreshWalletState(false);
  }

  async function waitForGameStateUpdate(previousState: GameState, expectedPlayer: string) {
    const expectedPlayerLower = expectedPlayer.toLowerCase();

    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(CONFIG.pollIntervalMs);
      const nextState = await fetchGameState();
      setGameState(nextState);
      setGameStateError(null);

      const potIncreased = BigInt(nextState.potRaw) > BigInt(previousState.potRaw);
      const playerUpdated = nextState.lastPlayerAddress?.toLowerCase() === expectedPlayerLower;

      if (potIncreased || playerUpdated) {
        return nextState;
      }
    }

    throw new Error("USDC transfer confirmed, but the Michelson state did not update in time.");
  }

  async function pressButton() {
    const ethereum = getEthereum();
    if (!ethereum) {
      setActionState({ kind: "error", message: "MetaMask is not available in this browser." });
      return;
    }

    if (!walletState.address) {
      setActionState({ kind: "error", message: "Connect MetaMask before pressing the button." });
      return;
    }

    if (!onExpectedNetwork) {
      setActionState({ kind: "error", message: "Switch MetaMask to TezosX EVM first." });
      return;
    }

    setIsSubmitting(true);
    setActionState({
      kind: "pending",
      message: "Preparing the 1 USDC transfer to the pot address.",
    });

    try {
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const currentState = gameState ?? (await fetchGameState());

      if (!currentState) {
        throw new Error("Game state is unavailable.");
      }

      if (currentState.claimed) {
        throw new Error("This session has already been claimed.");
      }

      if (currentState.sessionEnd <= Math.floor(Date.now() / 1000)) {
        throw new Error("The current session has already ended.");
      }

      const usdc = new ethers.Contract(CONFIG.usdcAddress, ERC20_ABI, signer);
      setActionState({
        kind: "pending",
        message: "Confirm the 1 USDC transfer in MetaMask.",
      });

      const tx = await usdc.transfer(CONFIG.potAddress, PRESS_AMOUNT_UNITS);
      setActionState({
        kind: "pending",
        message: "Transfer submitted. Waiting for EVM confirmation...",
        txHash: tx.hash,
      });

      await tx.wait();

      setActionState({
        kind: "pending",
        message: "Transfer confirmed. Waiting for the Tezos runtime state update...",
        txHash: tx.hash,
      });

      await waitForGameStateUpdate(currentState, walletState.address);
      await refreshWalletState(false);

      setActionState({
        kind: "success",
        message: "Button press recorded. The Tezlink game state has updated.",
        txHash: tx.hash,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Button press failed.";
      setActionState({ kind: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <main className="app">
        <header className="hero">
          <p className="eyebrow">Tezos X / CRAC Demo</p>
          <h1>XButton</h1>
          <p className="hero-copy">
            Send exactly 1 USDC on the EVM runtime, then watch the relayer update Michelson
            storage on Tezos.
          </p>
        </header>

        <section className="panel">
          <div className="panel-header">
            <h2>Wallet</h2>
            <div className="wallet-actions">
              {!walletState.address ? (
                <button onClick={connectWallet} disabled={isConnecting || !hasMetaMask}>
                  {isConnecting ? "Connecting..." : "Connect MetaMask"}
                </button>
              ) : !onExpectedNetwork ? (
                <>
                  <button onClick={switchNetwork}>Switch to TezosX EVM</button>
                  <button className="secondary-button" onClick={disconnectWallet}>
                    Disconnect
                  </button>
                </>
              ) : (
                <>
                  <span className="chip success">Ready</span>
                  <button className="secondary-button" onClick={disconnectWallet}>
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid two">
            <div className="stat">
              <span>Wallet Address</span>
              <strong>{shortenAddress(walletState.address, 8)}</strong>
            </div>
            <div className="stat">
              <span>Network</span>
              <strong>{onExpectedNetwork ? "TezosX EVM" : "Wrong network"}</strong>
            </div>
            <div className="stat">
              <span>Chain ID</span>
              <strong>{walletState.chainId ? walletState.chainId.toString() : "Not connected"}</strong>
            </div>
            <div className="stat">
              <span>USDC Balance</span>
              <strong>
                {walletState.usdcBalance ? `${walletState.usdcBalance} USDC` : "Unavailable"}
              </strong>
            </div>
          </div>

          {!hasMetaMask ? (
            <p className="inline-note error">MetaMask was not detected in this browser.</p>
          ) : null}
          {walletError ? <p className="inline-note error">{walletError}</p> : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Live Game State</h2>
            <span className="chip">Polling every 5s</span>
          </div>

          <div className="grid two">
            <div className="stat">
              <span>Pot</span>
              <strong>{gameState ? `${gameState.potDisplay} USDC` : "Loading..."}</strong>
            </div>
            <div className="stat">
              <span>Last Player</span>
              <strong>
                {gameState?.lastPlayerAddress
                  ? shortenAddress(gameState.lastPlayerAddress, 8)
                  : gameState?.lastPlayerBytes ?? "Loading..."}
              </strong>
            </div>
            <div className="stat">
              <span>Session Ends</span>
              <strong>{sessionLabel}</strong>
            </div>
            <div className="stat">
              <span>Claimed</span>
              <strong>{gameState ? (gameState.claimed ? "Yes" : "No") : "Loading..."}</strong>
            </div>
          </div>

          <div className="grid two compact">
            <div className="stat">
              <span>Pot Address</span>
              <strong>{CONFIG.potAddress}</strong>
            </div>
            <div className="stat">
              <span>Game Contract</span>
              <strong>{CONFIG.gameContract}</strong>
            </div>
            <div className="stat">
              <span>USDC Token</span>
              <strong>{CONFIG.usdcAddress}</strong>
            </div>
            <div className="stat">
              <span>Tezlink RPC</span>
              <strong>{CONFIG.tezlinkRpc}</strong>
            </div>
          </div>

          {gameState ? (
            <p className="inline-note">
              Last refresh: {new Date(gameState.fetchedAt).toLocaleTimeString()}
            </p>
          ) : null}
          {gameStateError ? <p className="inline-note error">{gameStateError}</p> : null}
        </section>

        <section className="panel action-panel">
          <div className="panel-header">
            <h2>Press The Button</h2>
            <span className="chip">{CONFIG.pressAmount} USDC</span>
          </div>

          <p className="action-copy">
            This sends 1 USDC to the pot on the EVM runtime. The relayer should detect the
            transfer and call `record_deposit` through the CRAC gateway.
          </p>

          <button className="primary-button" onClick={pressButton} disabled={!canPressButton}>
            {isSubmitting ? "Processing..." : "Press XButton"}
          </button>

          {!sessionActive ? (
            <p className="inline-note error">The session has ended, so deposits will not update the game.</p>
          ) : null}
          {gameState?.claimed ? (
            <p className="inline-note error">This session has already been claimed.</p>
          ) : null}

          <div className={`status ${actionState.kind}`}>
            <span className="status-label">{actionState.kind.toUpperCase()}</span>
            <p>{actionState.message}</p>
            {actionState.txHash ? <code>{actionState.txHash}</code> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export default App;

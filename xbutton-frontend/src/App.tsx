import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

const evmRpc = import.meta.env.VITE_EVM_RPC ?? "https://demo.txpark.nomadic-labs.com/rpc";
const tezlinkRpc = import.meta.env.VITE_TEZLINK_RPC ?? "https://demo.txpark.nomadic-labs.com/rpc/tezlink";
const evmExplorerUrl =
  import.meta.env.VITE_EVM_EXPLORER_URL ?? "https://demo-blockscout.txpark.nomadic-labs.com";
const tezosExplorerBase =
  import.meta.env.VITE_TEZOS_EXPLORER_BASE ?? "https://sandbox.tezlink.tzkt.io";
const chainId = BigInt(import.meta.env.VITE_CHAIN_ID ?? "127124");
const usdcAddress = import.meta.env.VITE_USDC_ADDRESS ?? "0x92E791DF3Dd5A8704f0e7d9B3003A0627d95d017";
const potAddress = import.meta.env.VITE_POT_ADDRESS ?? "0x34A76754E2aA034c02FEd2b87b5a6f647043d441";
const gameContract = import.meta.env.VITE_GAME_CONTRACT ?? "KT1Whp8174wXWCmhKKojfS3AdzKgTRaH9mie";
const cracPrecompile =
  import.meta.env.VITE_CRAC_PRECOMPILE ?? "0xff00000000000000000000000000000000000007";
const usdcDecimals = Number(import.meta.env.VITE_USDC_DECIMALS ?? "6");
const pressAmount = import.meta.env.VITE_PRESS_AMOUNT ?? "1";
const pollIntervalMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? "5000");
const DEFAULT_TESTNET_FAUCET_URL = "https://tezosx-evm-usdc-airdrop.vercel.app/";
const faucetUrl =
  import.meta.env.VITE_FAUCET_URL?.trim() || DEFAULT_TESTNET_FAUCET_URL;

const tzktApiUrl = tezlinkRpc.replace(/\/rpc\/tezlink\/?$/, "") + "/tzkt";

const CONFIG = {
  appName: "XButton",
  evmRpc,
  tezlinkRpc,
  tezlinkStorageUrl: `${tezlinkRpc}/chains/main/blocks/head/context/contracts/${gameContract}/storage`,
  evmExplorerUrl,
  tezosExplorerBase,
  tzktApiUrl,
  chainId,
  chainIdHex: `0x${chainId.toString(16)}`,
  usdcAddress,
  potAddress,
  gameContract,
  cracPrecompile,
  usdcDecimals,
  pressAmount,
  pollIntervalMs,
} as const;

function evmAddressUrl(address: string) {
  return `${CONFIG.evmExplorerUrl}/address/${address}`;
}

function evmTokenUrl(address: string) {
  return `${CONFIG.evmExplorerUrl}/token/${address}`;
}

function evmTxUrl(txHash: string) {
  return `${CONFIG.evmExplorerUrl}/tx/${txHash}`;
}

function tezosContractUrl(address: string) {
  return `${CONFIG.tezosExplorerBase}/${address}?tzkt_api_url=${encodeURIComponent(CONFIG.tzktApiUrl)}`;
}

function isEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTezosAddress(value: string) {
  return /^KT1[a-zA-Z0-9]{33}$/.test(value);
}

const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

const ESCROW_ABI = [
  "function deposit(uint256 amount)",
  "event PaidOut(address indexed winner, uint256 amount)",
];

const GATEWAY_ABI = [
  "function callMichelson(string destination, string entrypoint, bytes data) external payable",
];

// Micheline binary for Unit — the claim entrypoint parameter.
// The gateway routes by entrypoint name, so we only encode the parameter value itself.
// 03 = bare prim (no args, no annotations), 0b = D_Unit
const CLAIM_PARAM_HEX = "030b";

// Default session duration in seconds (5 minutes). start_session takes an int.
const DEFAULT_SESSION_DURATION_SEC = 300;

/** Encode a non-negative int as Micheline bytes: 0x00 (int tag) + zarith encoding */
function encodeMichelineInt(value: number): string {
  let n = BigInt(value);
  if (n < 0n) throw new Error("encodeMichelineInt: non-negative only");
  const bytes: number[] = [0x00];
  let first = Number(n & 0x3fn);
  n >>= 6n;
  if (n > 0n) first |= 0x80;
  bytes.push(first);
  while (n > 0n) {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    bytes.push(b);
  }
  return "0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PRESS_AMOUNT_UNITS = ethers.parseUnits(CONFIG.pressAmount, CONFIG.usdcDecimals);

type TezlinkNode = {
  prim?: string;
  args?: TezlinkNode[];
  bytes?: string;
  int?: string;
};

type GameState = {
  lastPlayerBytes: string;
  lastPlayerAddress: string | null;
  potRaw: string;
  potDisplay: string;
  sessionEnd: number;
  claimed: boolean;
  payoutCompleted: boolean;
  fetchedAt: number;
};

type WalletState = {
  address: string | null;
  chainId: bigint | null;
  usdcBalance: string | null;
  usdcAllowance: bigint | null;
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

function ExplorableAddress({
  address,
  displayText,
  type = "address",
}: {
  address: string | null;
  displayText?: string;
  type?: "address" | "token" | "contract";
}) {
  if (!address) return <>{displayText ?? "—"}</>;
  const text = displayText ?? shortenAddress(address, 8);
  const href =
    type === "token" && isEvmAddress(address)
      ? evmTokenUrl(address)
      : isEvmAddress(address)
        ? evmAddressUrl(address)
        : isTezosAddress(address)
          ? tezosContractUrl(address)
          : null;
  if (!href) return <>{text}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="explorer-link">
      {text}
    </a>
  );
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
  // storage: (pair last_player (pair pot (pair session_end (pair claim_requested payout_completed))))
  const levelOne = storage.args;           // [last_player, pair(pot,...)]
  const levelTwo = levelOne?.[1]?.args;    // [pot, pair(session_end,...)]
  const levelThree = levelTwo?.[1]?.args;  // [session_end, pair(claim_requested, payout_completed)]
  const levelFour = levelThree?.[1]?.args; // [claim_requested, payout_completed]

  const lastPlayerBytes = levelOne?.[0]?.bytes;
  const potRaw = levelTwo?.[0]?.int;
  const sessionEndRaw = levelThree?.[0]?.int;
  const claimedPrim = levelFour?.[0]?.prim;
  const payoutCompletedPrim = levelFour?.[1]?.prim;

  if (!lastPlayerBytes || !potRaw || !sessionEndRaw || claimedPrim === undefined) {
    throw new Error("Unexpected Tezlink storage shape.");
  }

  return {
    lastPlayerBytes,
    lastPlayerAddress: formatMaybeEvmAddress(lastPlayerBytes),
    potRaw,
    potDisplay: formatTokenAmount(BigInt(potRaw), CONFIG.usdcDecimals),
    sessionEnd: Number(sessionEndRaw),
    claimed: claimedPrim === "True",
    payoutCompleted: payoutCompletedPrim === "True",
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

async function fetchPayoutTxHash(
  winnerAddress: string,
): Promise<string | null> {
  const ethereum = getEthereum();
  if (!ethereum) return null;
  try {
    const provider = new ethers.BrowserProvider(ethereum);
    const escrow = new ethers.Contract(CONFIG.potAddress, ESCROW_ABI, provider);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 999);
    // Try with winner filter first.
    const filterByWinner = escrow.filters.PaidOut(winnerAddress);
    const winnerLogs = await escrow.queryFilter(filterByWinner, fromBlock, "latest");
    if (winnerLogs.length > 0) {
      return winnerLogs[winnerLogs.length - 1].transactionHash ?? null;
    }
    // Fallback: most recent PaidOut event to any address in the window.
    const allLogs = await escrow.queryFilter(escrow.filters.PaidOut(), fromBlock, "latest");
    if (allLogs.length > 0) {
      return allLogs[allLogs.length - 1].transactionHash ?? null;
    }
  } catch {
    /* RPC may reject wide log queries */
  }
  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    chainId: null,
    usdcBalance: null,
    usdcAllowance: null,
  });
  const [isWalletDisconnected, setIsWalletDisconnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameStateError, setGameStateError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [payoutTxHash, setPayoutTxHash] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>({
    kind: "idle",
    message: "Connect MetaMask, then press the button to deposit 1 USDC to the escrow.",
  });

  const hasMetaMask = typeof window !== "undefined" && Boolean(getEthereum());
  const onExpectedNetwork = walletState.chainId === CONFIG.chainId;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionActive = gameState ? gameState.sessionEnd > nowSeconds : true;
  const needsApproval =
    walletState.address &&
    walletState.usdcAllowance !== null &&
    walletState.usdcAllowance < PRESS_AMOUNT_UNITS;
  const canPressButton =
    hasMetaMask &&
    Boolean(walletState.address) &&
    onExpectedNetwork &&
    !isSubmitting &&
    sessionActive &&
    !gameState?.claimed;

  const canClaim =
    hasMetaMask &&
    Boolean(walletState.address) &&
    onExpectedNetwork &&
    !sessionActive &&
    !isClaiming &&
    Boolean(gameState);

  // Session ended: allow starting a new round even if prior claim/payout is still pending (on-chain reset).
  const canStartNewSession =
    hasMetaMask &&
    Boolean(walletState.address) &&
    onExpectedNetwork &&
    !isStartingSession &&
    Boolean(gameState) &&
    !sessionActive;

  const sessionLabel = useMemo(() => {
    if (!gameState) return "Loading...";
    return new Date(gameState.sessionEnd * 1000).toLocaleString();
  }, [gameState]);

  const refreshWalletState = useCallback(async (requestAccounts = false) => {
    if (isWalletDisconnected && !requestAccounts) {
      setWalletState({ address: null, chainId: null, usdcBalance: null, usdcAllowance: null });
      return;
    }

    const ethereum = getEthereum();
    if (!ethereum) {
      setWalletState({ address: null, chainId: null, usdcBalance: null, usdcAllowance: null });
      return;
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const accounts = (await provider.send(
      requestAccounts ? "eth_requestAccounts" : "eth_accounts",
      [],
    )) as string[];

    if (accounts.length === 0) {
      setWalletState({ address: null, chainId: null, usdcBalance: null, usdcAllowance: null });
      return;
    }

    const address = ethers.getAddress(accounts[0]);
    const network = await provider.getNetwork();
    const usdc = new ethers.Contract(CONFIG.usdcAddress, ERC20_ABI, provider);
    const [balance, allowance] = await Promise.all([
      usdc.balanceOf(address) as Promise<bigint>,
      usdc.allowance(address, CONFIG.potAddress) as Promise<bigint>,
    ]);

    setWalletState({
      address,
      chainId: network.chainId,
      usdcBalance: formatTokenAmount(balance, CONFIG.usdcDecimals),
      usdcAllowance: allowance,
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

  // When payout completes (on load or after relayer syncs), fetch the payout tx hash and update UI.
  useEffect(() => {
    if (!gameState?.payoutCompleted) {
      setPayoutTxHash(null);
      return;
    }
    setActionState((prev) =>
      prev.message.toLowerCase().includes("waiting for payout")
        ? { kind: "success", message: "Payout complete. The winner has been paid." }
        : prev
    );
    if (gameState.lastPlayerAddress) {
      void fetchPayoutTxHash(gameState.lastPlayerAddress).then((txHash) => {
        if (txHash) {
          setPayoutTxHash(txHash);
          setActionState((prev) =>
            prev.message.toLowerCase().includes("payout complete")
              ? { kind: "success", message: "Payout complete. The winner has been paid.", txHash }
              : prev
          );
        }
      });
    }
  }, [gameState?.payoutCompleted, gameState?.lastPlayerAddress, gameState?.potRaw]);

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

  async function disconnectWallet() {
    const ethereum = getEthereum();
    if (ethereum?.request) {
      try {
        await ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // wallet_revokePermissions may not be supported by all wallets
      }
    }
    setIsWalletDisconnected(true);
    setWalletError(null);
    setWalletState({ address: null, chainId: null, usdcBalance: null, usdcAllowance: null });
    setActionState({
      kind: "idle",
      message: "Wallet disconnected. Connect MetaMask again to press the button.",
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

    throw new Error("Deposit confirmed, but the Michelson state did not update in time.");
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
      message: "Preparing the 1 USDC deposit to the escrow.",
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

      if (needsApproval) {
        setActionState({ kind: "pending", message: "Approve USDC spend. Confirm in MetaMask." });
        const usdc = new ethers.Contract(CONFIG.usdcAddress, ERC20_ABI, signer);
        const approveTx = await usdc.approve(CONFIG.potAddress, PRESS_AMOUNT_UNITS);
        await approveTx.wait();
        await refreshWalletState(false);
      }

      const escrow = new ethers.Contract(CONFIG.potAddress, ESCROW_ABI, signer);
      setActionState({
        kind: "pending",
        message: "Confirm the 1 USDC deposit in MetaMask.",
      });

      const tx = await escrow.deposit(PRESS_AMOUNT_UNITS);
      setActionState({
        kind: "pending",
        message: "Deposit submitted. Waiting for EVM confirmation...",
        txHash: tx.hash,
      });

      await tx.wait();

      setActionState({
        kind: "pending",
        message: "Deposit confirmed. Waiting for the Tezos runtime state update...",
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

  async function claimContract() {
    const ethereum = getEthereum();
    if (!ethereum) {
      setActionState({ kind: "error", message: "MetaMask is not available in this browser." });
      return;
    }

    if (!walletState.address) {
      setActionState({ kind: "error", message: "Connect MetaMask before claiming." });
      return;
    }

    if (!onExpectedNetwork) {
      setActionState({ kind: "error", message: "Switch MetaMask to TezosX EVM first." });
      return;
    }

    setIsClaiming(true);
    setActionState({ kind: "pending", message: "Checking claim status..." });

    try {
      const currentState = await refreshGameState();
      if (currentState?.claimed) {
        const payoutHash = await fetchPayoutTxHash(walletState.address);
        setActionState({
          kind: "success",
          message: payoutHash
            ? "Winnings have already been claimed. Payout transfer below."
            : "Winnings have already been claimed.",
          txHash: payoutHash ?? undefined,
        });
        setIsClaiming(false);
        return;
      }

      if (
        currentState?.lastPlayerAddress &&
        walletState.address.toLowerCase() !== currentState.lastPlayerAddress.toLowerCase()
      ) {
        setActionState({
          kind: "error",
          message: `This wallet is not the last player. Only the last player can claim. Funds will be sent to the last player's address: ${currentState.lastPlayerAddress}.`,
        });
        setIsClaiming(false);
        return;
      }

      setActionState({
        kind: "pending",
        message: "Confirm the claim transaction in MetaMask.",
      });

      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const gateway = new ethers.Contract(CONFIG.cracPrecompile, GATEWAY_ABI, signer);

      const tx = await gateway.callMichelson(
        CONFIG.gameContract,
        "claim",
        `0x${CLAIM_PARAM_HEX}`,
        { value: 0n, gasLimit: 2_000_000n }
      );

      setActionState({
        kind: "pending",
        message: "Claim submitted. Waiting for confirmation...",
        txHash: tx.hash,
      });

      await tx.wait();
      await refreshGameState();

      setActionState({
        kind: "success",
        message: "Claim recorded. Waiting for payout...",
        txHash: tx.hash,
      });
    } catch (error) {
      const err = error as { code?: string; message?: string; shortMessage?: string };
      const isRevert =
        err?.code === "CALL_EXCEPTION" ||
        err?.message?.toLowerCase().includes("reverted") ||
        err?.shortMessage?.toLowerCase().includes("reverted");

      if (isRevert) {
        const fresh = await refreshGameState();
        if (fresh?.claimed) {
          const winnerAddress = fresh.lastPlayerAddress ?? walletState.address ?? "";
          const payoutHash = winnerAddress
            ? await fetchPayoutTxHash(winnerAddress)
            : null;
          setActionState({
            kind: "success",
            message:
              "This session has already been claimed. Winnings have been sent to the last player."
              + (payoutHash ? " Payout transaction below." : ""),
            txHash: payoutHash ?? undefined,
          });
        } else {
          setActionState({
            kind: "error",
            message:
              "The claim failed. This session may already have been claimed, or the session might still be active. Refresh the page to see the current status.",
          });
        }
      } else {
        const message = error instanceof Error ? error.message : "Claim failed.";
        setActionState({ kind: "error", message });
      }
    } finally {
      setIsClaiming(false);
    }
  }

  async function startNewSession() {
    const ethereum = getEthereum();
    if (!ethereum || !walletState.address || !onExpectedNetwork) {
      setActionState({ kind: "error", message: "Connect MetaMask and switch to TezosX EVM." });
      return;
    }
    setIsStartingSession(true);
    setActionState({ kind: "pending", message: "Starting new session..." });
    try {
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const gateway = new ethers.Contract(CONFIG.cracPrecompile, GATEWAY_ABI, signer);
      const durationBytes = encodeMichelineInt(DEFAULT_SESSION_DURATION_SEC);
      const tx = await gateway.callMichelson(
        CONFIG.gameContract,
        "start_session",
        durationBytes,
        { value: 0n, gasLimit: 2_000_000n },
      );
      setActionState({
        kind: "pending",
        message: "Transaction submitted. Waiting for confirmation...",
        txHash: tx.hash,
      });
      await tx.wait();
      await refreshGameState();
      setActionState({
        kind: "success",
        message: `New session started (${DEFAULT_SESSION_DURATION_SEC / 60} minutes). You can press the button again.`,
        txHash: tx.hash,
      });
    } catch (error) {
      const err = error as { code?: string; message?: string; shortMessage?: string };
      const isRevert =
        err?.code === "CALL_EXCEPTION" ||
        err?.message?.toLowerCase().includes("reverted") ||
        err?.shortMessage?.toLowerCase().includes("reverted");
      setActionState({
        kind: "error",
        message: isRevert
          ? "Start session failed. Refresh and try again."
          : (error instanceof Error ? error.message : "Start session failed."),
      });
    } finally {
      setIsStartingSession(false);
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
              <strong>
                <ExplorableAddress
                  address={walletState.address}
                  displayText={!walletState.address ? "Not connected" : undefined}
                />
              </strong>
            </div>
            <div className="stat">
              <span>USDC Balance</span>
              <strong>
                {walletState.usdcBalance ? `${walletState.usdcBalance} USDC` : "Unavailable"}
              </strong>
            </div>
          </div>

          <p className="inline-note faucet-hint">
            Need testnet funds? Get some from the{" "}
            <a
              href={faucetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="explorer-link"
            >
              faucet
            </a>
            .
          </p>

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
              <span>Current Last Player</span>
              <strong>
                {gameState?.lastPlayerAddress ? (
                  <ExplorableAddress address={gameState.lastPlayerAddress} />
                ) : (
                  gameState?.lastPlayerBytes ?? "Loading..."
                )}
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
            <div className="stat">
              <span>Pot Address</span>
              <strong>
                <ExplorableAddress address={CONFIG.potAddress} />
              </strong>
            </div>
            <div className="stat">
              <span>Game Contract</span>
              <strong>
                <ExplorableAddress address={CONFIG.gameContract} />
              </strong>
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
            {canStartNewSession ? (
              <button
                className="primary-button"
                onClick={startNewSession}
                disabled={!canStartNewSession || isStartingSession}
              >
                {isStartingSession ? "Starting..." : "Start new session"}
              </button>
            ) : (
              <span className="chip">{CONFIG.pressAmount} USDC</span>
            )}
          </div>

          <p className="action-copy">
            {canStartNewSession
              ? "Starts a fresh session on the game contract (resets pot and claim state). Use when the previous session ended — even if winnings were not claimed yet or payout is still pending."
              : "Press once to deposit 1 USDC to the escrow. If needed, approve and deposit happen in sequence. The relayer detects the deposit and calls `record_deposit` through the CRAC gateway."}
          </p>

          <button className="primary-button" onClick={pressButton} disabled={!canPressButton}>
            {isSubmitting ? "Processing..." : "Press XButton"}
          </button>

          {canClaim ? (
            <button className="primary-button" onClick={claimContract} disabled={!canClaim}>
              {isClaiming ? "Claiming..." : "Claim Winnings"}
            </button>
          ) : null}

          {!sessionActive && !gameState?.claimed ? (
            <p className="inline-note error">The session has ended, so deposits will not update the game.</p>
          ) : null}
          {gameState?.payoutCompleted ? (
            <p className="inline-note">
              Payout complete. USDC has been sent to the winner.
              {" "}
              {payoutTxHash ? (
                <a href={evmTxUrl(payoutTxHash)} target="_blank" rel="noopener noreferrer" className="explorer-link">
                  View transfer
                </a>
              ) : (
                <a href={evmAddressUrl(CONFIG.potAddress)} target="_blank" rel="noopener noreferrer" className="explorer-link">
                  View escrow
                </a>
              )}
            </p>
          ) : gameState?.claimed &&
          walletState.address &&
          gameState.lastPlayerAddress &&
          walletState.address.toLowerCase() !== gameState.lastPlayerAddress.toLowerCase() ? (
            <p className="inline-note error">
              This wallet is not the last player. The funds have been sent to the last player’s
              wallet address: <ExplorableAddress address={gameState.lastPlayerAddress} />.
            </p>
          ) : gameState?.claimed ? (
            <p className="inline-note">
              Waiting for payout... The relayer will send USDC to the winner. If it doesn’t arrive
              in a minute, ensure the relayer is running and refresh your wallet balance.
            </p>
          ) : null}

          <div className={`status ${actionState.kind}`}>
            <span className="status-label">{actionState.kind.toUpperCase()}</span>
            <p>{actionState.message}</p>
            {actionState.txHash ? (
              <code>
                <a
                  href={evmTxUrl(actionState.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="explorer-link"
                >
                  {actionState.txHash}
                </a>
              </code>
            ) : null}
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

import { useState, useCallback, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import CreateAccountTab from "@/components/panel/CreateAccountTab";
import HistoryTab from "@/components/panel/HistoryTab";
import SettingsTab from "@/components/panel/SettingsTab";
import WithdrawalTab from "@/components/panel/WithdrawalTab";
import LoginTab, { type FaucetPayLoginResult } from "@/components/panel/LoginTab";
import StatusBar from "@/components/panel/StatusBar";
import LogPanel from "@/components/panel/LogPanel";
import {
  Wifi,
  WifiOff,
  UserPlus,
  History,
  Settings as SettingsIcon,
  CheckCircle2,
  XCircle,
  Banknote,
  LogIn,
} from "lucide-react";

export type LogEntry = {
  msg: string;
  type: "info" | "success" | "warn" | "error";
  timestamp: string;
};

export type StepStatus = "idle" | "running" | "done" | "failed";

export type StatusState = {
  captcha: StepStatus;
  register: StepStatus;
  activate: StepStatus;
  seofast_register: StepStatus;
  seofast_verify: StepStatus;
  seofast_wallet: StepStatus;
};

export type AccountResult = {
  success: boolean;
  message: string;
  account?: {
    username: string;
    email: string;
    password: string;
    status: string;
    createdAt: number;
    seofastUsername?: string | null;
    seofastStatus?: string | null;
  };
};

type NavKey = "create" | "login" | "withdrawal" | "history" | "settings";

const NAV_ITEMS: { key: NavKey; label: string; icon: typeof UserPlus }[] = [
  { key: "create", label: "Criar Conta", icon: UserPlus },
  { key: "login", label: "Login", icon: LogIn },
  { key: "withdrawal", label: "Saque", icon: Banknote },
  { key: "history", label: "Histórico", icon: History },
  { key: "settings", label: "Configurações", icon: SettingsIcon },
];

export default function Panel() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    try {
      const saved = localStorage.getItem("faucetpay_process_logs");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [status, setStatus] = useState<StatusState>(() => {
    try {
      const saved = localStorage.getItem("faucetpay_process_status");
      return saved ? JSON.parse(saved) : {
        captcha: "idle",
        register: "idle",
        activate: "idle",
        seofast_register: "idle",
        seofast_verify: "idle",
        seofast_wallet: "idle",
      };
    } catch {
      return {
        captcha: "idle",
        register: "idle",
        activate: "idle",
        seofast_register: "idle",
        seofast_verify: "idle",
        seofast_wallet: "idle",
      };
    }
  });
  const [isRunning, setIsRunning] = useState(() => {
    try {
      return localStorage.getItem("faucetpay_process_running") === "true";
    } catch { return false; }
  });
  const [result, setResult] = useState<AccountResult | null>(() => {
    try {
      const saved = localStorage.getItem("faucetpay_process_result");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [activeTab, setActiveTab] = useState<NavKey>("create");
  const [loginResult, setLoginResult] = useState<FaucetPayLoginResult | null>(null);
  const [loginRunning, setLoginRunning] = useState(false);

  const utils = trpc.useUtils();

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    const timestamp = new Date().toLocaleTimeString("pt-BR");
    setLogs((prev) => {
      const updated = [...prev, { msg, type, timestamp }];
      try { localStorage.setItem("faucetpay_process_logs", JSON.stringify(updated.slice(-200))); } catch {}
      return updated;
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem("faucetpay_process_status", JSON.stringify(status)); } catch {}
  }, [status]);

  useEffect(() => {
    try { localStorage.setItem("faucetpay_process_running", String(isRunning)); } catch {}
  }, [isRunning]);

  useEffect(() => {
    try {
      if (result) localStorage.setItem("faucetpay_process_result", JSON.stringify(result));
      else localStorage.removeItem("faucetpay_process_result");
    } catch {}
  }, [result]);

  useEffect(() => {
    const socketUrl = window.location.origin;
    const s = io(socketUrl, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      setConnected(true);
      addLog("Conectado ao servidor", "success");
    });

    s.on("disconnect", () => {
      setConnected(false);
      addLog("Desconectado do servidor", "error");
    });

    s.on("log", (data: { msg: string; type: LogEntry["type"] }) => {
      addLog(data.msg, data.type);
    });

    s.on("status", (data: { step: keyof StatusState; status: StepStatus }) => {
      setStatus((prev) => ({ ...prev, [data.step]: data.status }));
    });

    s.on("result", (data: AccountResult) => {
      setIsRunning(false);
      setResult(data);
      utils.accounts.list.invalidate();
      try { localStorage.setItem("faucetpay_process_running", "false"); } catch {}
    });

    s.on("faucetpay_login_result", (data: FaucetPayLoginResult) => {
      setLoginRunning(false);
      setLoginResult(data);
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, [addLog, utils]);

  // Captura headers reais do navegador do usuário
  const getBrowserHeaders = () => {
    return {
      "user-agent": navigator.userAgent,
      "accept-language": navigator.language + (navigator.languages?.length > 1 ? "," + navigator.languages.slice(1).map((l, i) => `${l};q=${(0.9 - i * 0.1).toFixed(1)}`).join(",") : ""),
      "sec-ch-ua": (navigator as any).userAgentData?.brands?.map((b: any) => `"${b.brand}";v="${b.version}"`).join(", ") || "",
      "sec-ch-ua-mobile": (navigator as any).userAgentData?.mobile ? "?1" : "?0",
      "sec-ch-ua-platform": `"${(navigator as any).userAgentData?.platform || navigator.platform || "Unknown"}"`,
      "screen-resolution": `${screen.width}x${screen.height}`,
      "device-pixel-ratio": String(window.devicePixelRatio || 1),
      "timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  };

  const handleCreateAccount = (data: {
    username: string;
    email: string;
    password: string;
    referrer?: string;
    createSeofast?: boolean;
  }) => {
    if (!socket || !connected) {
      addLog("Não conectado ao servidor!", "error");
      return;
    }
    setIsRunning(true);
    setResult(null);
    setStatus({
      captcha: "idle",
      register: "idle",
      activate: "idle",
      seofast_register: "idle",
      seofast_verify: "idle",
      seofast_wallet: "idle",
    });
    setLogs([]);
    socket.emit("create_account", { ...data, browserHeaders: getBrowserHeaders() });
  };

  const handleWithdrawal = (data: { email: string; password: string; amount: number }) => {
    if (!socket || !connected) {
      addLog("Não conectado ao servidor!", "error");
      return;
    }
    setIsRunning(true);
    setResult(null);
    setStatus({
      captcha: "idle",
      register: "idle",
      activate: "idle",
      seofast_register: "idle",
      seofast_verify: "idle",
      seofast_wallet: "idle",
    });
    setLogs([]);
    socket.emit("request_withdrawal", { ...data, browserHeaders: getBrowserHeaders() });
  };

  const handleFaucetPayLogin = (data: { email: string; password: string; twoFaCode?: string }) => {
    if (!socket || !connected) {
      addLog("Não conectado ao servidor!", "error");
      return;
    }
    setLoginRunning(true);
    setLoginResult(null);
    setStatus({
      captcha: "idle",
      register: "idle",
      activate: "idle",
      seofast_register: "idle",
      seofast_verify: "idle",
      seofast_wallet: "idle",
    });
    setLogs([]);
    socket.emit("faucetpay_login", { ...data, browserHeaders: getBrowserHeaders() });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[oklch(0.11_0.006_260)]">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 border-b border-[oklch(0.2_0.01_260)] bg-[oklch(0.12_0.007_260)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Tabs */}
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key)}
                    className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                      active
                        ? "bg-[oklch(0.18_0.02_250)] text-[oklch(0.85_0.05_250)] shadow-sm"
                        : "text-[oklch(0.5_0.01_260)] hover:bg-[oklch(0.16_0.01_260)] hover:text-[oklch(0.7_0.02_260)]"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${active ? "text-[oklch(0.7_0.18_250)]" : ""}`} />
                    <span className="hidden sm:inline">{item.label}</span>
                    {active && (
                      <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[oklch(0.7_0.18_250)] rounded-full" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                connected
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border border-red-500/20"
              }`}>
                {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                <span className="hidden sm:inline">{connected ? "Online" : "Offline"}</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">
        <div className="mx-auto max-w-[1400px]">
          {activeTab === "create" && (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
              <div className="xl:col-span-2 space-y-5">
                <CreateAccountTab onSubmit={handleCreateAccount} isRunning={isRunning} />
                {result && <ResultCard result={result} />}
              </div>
              <div className="xl:col-span-3 space-y-5">
                <StatusBar status={status} />
                <LogPanel logs={logs} />
              </div>
            </div>
          )}

          {activeTab === "login" && (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
              <div className="xl:col-span-2 space-y-5">
                <LoginTab onSubmit={handleFaucetPayLogin} isRunning={loginRunning} result={loginResult} />
              </div>
              <div className="xl:col-span-3 space-y-5">
                <StatusBar status={status} />
                <LogPanel logs={logs} />
              </div>
            </div>
          )}

          {activeTab === "withdrawal" && (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
              <div className="xl:col-span-2 space-y-5">
                <WithdrawalTab onSubmit={handleWithdrawal} isRunning={isRunning} />
                {result && <ResultCard result={result} />}
              </div>
              <div className="xl:col-span-3 space-y-5">
                <StatusBar status={status} />
                <LogPanel logs={logs} />
              </div>
            </div>
          )}

          {activeTab === "history" && <HistoryTab />}
          {activeTab === "settings" && <SettingsTab />}
        </div>
      </main>
    </div>
  );
}

function ResultCard({ result }: { result: AccountResult }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        result.success
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-red-500/5 border-red-500/20"
      }`}
    >
      <h3
        className={`flex items-center gap-2 font-semibold text-sm mb-2 ${
          result.success ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {result.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
        {result.success ? "Operação concluída" : "Falha na operação"}
      </h3>
      <p className="text-[12px] text-muted-foreground">{result.message}</p>
      {result.account && (
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] border-t border-border/40 pt-3">
          <ResultRow label="Usuário" value={result.account.username} />
          <ResultRow label="Email" value={result.account.email} />
          <ResultRow label="Senha" value={result.account.password} />
          <ResultRow label="Status" value={result.account.status} />
          {result.account.seofastUsername && (
            <ResultRow
              label="SEOFast"
              value={`${result.account.seofastUsername} (${result.account.seofastStatus ?? "—"})`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[oklch(0.5_0.01_260)]">{label}</span>
      <span className="text-foreground font-mono truncate text-[11px]">{value}</span>
    </div>
  );
}

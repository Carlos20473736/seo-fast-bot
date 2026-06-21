import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Zap,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { io, type Socket } from "socket.io-client";

const WITHDRAWAL_STORAGE_KEY = "faucetpay_withdrawal_draft";
const PROCESSING_TIMEOUT_MS = 60000; // 60 seconds timeout

type SessionStatus = "disconnected" | "connecting" | "connected" | "error";
type WithdrawalAvailability = "available" | "requires_approval" | "pending" | "no_wallet" | "unknown";

interface SessionState {
  status: SessionStatus;
  balance: string;
  withdrawalStatus?: WithdrawalAvailability;
  withdrawalMessage?: string;
  message?: string;
}

interface WithdrawalTabProps {
  onSubmit: (data: { email: string; password: string; amount: number }) => void;
  isRunning: boolean;
}

function loadWithdrawalDraft() {
  try {
    const raw = localStorage.getItem(WITHDRAWAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveWithdrawalDraft(data: { email: string; password: string; amount: string }) {
  try { localStorage.setItem(WITHDRAWAL_STORAGE_KEY, JSON.stringify(data)); } catch {}
}

export default function WithdrawalTab({ onSubmit, isRunning }: WithdrawalTabProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [amount, setAmount] = useState("30");
  const [session, setSession] = useState<SessionState>({ status: "disconnected", balance: "0" });
  const [checkingWithdrawal, setCheckingWithdrawal] = useState(false);
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [withdrawalUnavailable, setWithdrawalUnavailable] = useState(false);
  const [processingTime, setProcessingTime] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carregar draft salvo
  useEffect(() => {
    const draft = loadWithdrawalDraft();
    if (draft) {
      if (draft.email) setEmail(draft.email);
      if (draft.password) setPassword(draft.password);
      if (draft.amount) setAmount(draft.amount);
    }
  }, []);

  // Auto-salvar draft
  useEffect(() => {
    const timer = setTimeout(() => {
      if (email || password) {
        saveWithdrawalDraft({ email, password, amount });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [email, password, amount]);

  // Timeout para detectar saque indisponível
  useEffect(() => {
    if (isRunning) {
      setWithdrawalUnavailable(false);
      setProcessingTime(0);

      // Contador de tempo
      intervalRef.current = setInterval(() => {
        setProcessingTime((prev) => prev + 1);
      }, 1000);

      // Timeout - se ficar processando mais de 60s, saque indisponível
      timeoutRef.current = setTimeout(() => {
        setWithdrawalUnavailable(true);
        toast.error("Saque indisponível no momento. Tente novamente mais tarde.");
      }, PROCESSING_TIMEOUT_MS);
    } else {
      // Limpar timers quando parar de processar
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setProcessingTime(0);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  // Socket connection
  useEffect(() => {
    const socketUrl = window.location.origin;
    const s: Socket = io(socketUrl, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    s.on("session_update", (data: { email: string; status: SessionStatus; balance: string; message?: string }) => {
      if (data.email === email || !email) {
        setSession({
          status: data.status,
          balance: data.balance,
          message: data.message,
        });
        if (data.status === "connected") {
          toast.success(`Conectado! Saldo: ₽${data.balance}`);
        } else if (data.status === "error") {
          toast.error(data.message || "Erro no login");
        }
      }
    });

    s.on("balance_update", (data: { email: string; balance: string; success: boolean }) => {
      if (data.success) {
        setSession((prev) => ({ ...prev, balance: data.balance }));
      }
    });

    s.on("withdrawal_status", (data: { email: string; status: WithdrawalAvailability; balance: string; message: string }) => {
      setCheckingWithdrawal(false);
      setSession((prev) => ({
        ...prev,
        balance: data.balance,
        withdrawalStatus: data.status,
        withdrawalMessage: data.message,
      }));

      if (data.status === "available") {
        toast.success("Saque disponível!");
      } else if (data.status === "requires_approval") {
        toast.warning("Conta requer aprovação antes do saque");
      } else if (data.status === "pending") {
        toast.info("Aprovação pendente. Aguarde.");
      }
    });

    s.on("approval_result", (data: { email: string; success: boolean; status: string; message: string }) => {
      setRequestingApproval(false);
      if (data.success) {
        toast.success(data.message);
        setSession((prev) => ({ ...prev, withdrawalStatus: "available" }));
      } else {
        toast.warning(data.message);
        if (data.status === "pending") {
          setSession((prev) => ({ ...prev, withdrawalStatus: "pending" }));
        }
      }
    });

    socketRef.current = s;

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [email]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !socketRef.current) return;
    setSession({ status: "connecting", balance: "0" });
    socketRef.current.emit("seofast_login", { email, password });
  };

  const handleDisconnect = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("seofast_disconnect", { email });
    setSession({ status: "disconnected", balance: "0" });
  };

  const handleCheckWithdrawal = () => {
    if (!socketRef.current || !email || !password) return;
    setCheckingWithdrawal(true);
    socketRef.current.emit("check_withdrawal_status", { email, password });
  };

  const handleRequestApproval = () => {
    if (!socketRef.current || !email || !password) return;
    setRequestingApproval(true);
    socketRef.current.emit("seofast_request_approval", { email, password });
  };

  const handleRefreshBalance = () => {
    if (!socketRef.current || !email) return;
    socketRef.current.emit("seofast_refresh_balance", { email });
  };

  const handleSubmitWithdrawal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setWithdrawalUnavailable(false);
    onSubmit({ email, password, amount: parseInt(amount) || 30 });
  };

  const isConnected = session.status === "connected";
  const isConnecting = session.status === "connecting";

  return (
    <div className="space-y-4">
      {/* LOGIN CARD */}
      <div className="rounded-lg border border-[oklch(0.22_0.01_260)] bg-[oklch(0.13_0.008_260)]">
        <div className="px-5 py-3.5 border-b border-[oklch(0.2_0.01_260)]">
          <h3 className="text-[13px] font-semibold text-foreground">Sessão SEOFast</h3>
        </div>
        <div className="p-5">
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="text-[10px] font-semibold text-[oklch(0.5_0.01_260)] uppercase tracking-widest mb-1.5 block">
                Email
              </label>
              <Input
                type="email"
                placeholder="conta@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isConnected || isConnecting}
                className="h-9 bg-[oklch(0.1_0.005_260)] border-[oklch(0.22_0.01_260)] text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-[13px] rounded-md"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[oklch(0.5_0.01_260)] uppercase tracking-widest mb-1.5 block">
                Senha
              </label>
              <Input
                type="password"
                placeholder="Senha SEOFast"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isConnected || isConnecting}
                className="h-9 bg-[oklch(0.1_0.005_260)] border-[oklch(0.22_0.01_260)] text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-[13px] rounded-md"
                required
              />
            </div>

            {!isConnected ? (
              <Button
                type="submit"
                disabled={isConnecting || !email || !password}
                className="w-full h-9 bg-[oklch(0.25_0.02_250)] hover:bg-[oklch(0.3_0.03_250)] text-[oklch(0.85_0.05_250)] border border-[oklch(0.35_0.04_250)] font-medium text-[12px] rounded-md"
              >
                {isConnecting ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Conectando...</>
                ) : (
                  <><LogIn className="w-3.5 h-3.5 mr-2" />Conectar</>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleDisconnect}
                className="w-full h-9 bg-[oklch(0.15_0.02_20)] hover:bg-[oklch(0.2_0.03_20)] text-red-400 border border-red-500/20 font-medium text-[12px] rounded-md"
              >
                <LogOut className="w-3.5 h-3.5 mr-2" />
                Desconectar
              </Button>
            )}

            {session.status === "error" && session.message && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-red-500/8 border border-red-500/15">
                <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <p className="text-[11px] text-red-300">{session.message}</p>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* SESSION STATUS */}
      {isConnected && (
        <div className="rounded-lg border border-emerald-500/15 bg-[oklch(0.13_0.015_160)]">
          <div className="px-5 py-3.5 border-b border-emerald-500/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[12px] font-semibold text-emerald-400">Ativa</span>
            </div>
            <button
              onClick={handleRefreshBalance}
              className="p-1.5 rounded-md hover:bg-emerald-500/10 text-emerald-400/60 hover:text-emerald-400 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-3">
              {/* Saldo */}
              <div className="rounded-md bg-[oklch(0.1_0.005_260)] border border-[oklch(0.2_0.01_260)] p-3">
                <p className="text-[9px] uppercase tracking-widest text-[oklch(0.45_0.01_260)] mb-1">Saldo</p>
                <p className="text-lg font-bold text-emerald-300 font-mono">₽ {session.balance}</p>
              </div>
              {/* Status Saque */}
              <div className="rounded-md bg-[oklch(0.1_0.005_260)] border border-[oklch(0.2_0.01_260)] p-3">
                <p className="text-[9px] uppercase tracking-widest text-[oklch(0.45_0.01_260)] mb-1">Saque</p>
                <div className="mt-0.5">
                  {session.withdrawalStatus === "available" && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />Disponível
                    </span>
                  )}
                  {session.withdrawalStatus === "requires_approval" && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                      <AlertTriangle className="w-3 h-3" />Requer Aprovação
                    </span>
                  )}
                  {session.withdrawalStatus === "pending" && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400">
                      <Clock className="w-3 h-3" />Pendente
                    </span>
                  )}
                  {session.withdrawalStatus === "no_wallet" && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                      <Ban className="w-3 h-3" />Sem Carteira
                    </span>
                  )}
                  {!session.withdrawalStatus && (
                    <span className="text-[11px] text-[oklch(0.4_0.01_260)]">Não verificado</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-3.5">
              <button
                onClick={handleCheckWithdrawal}
                disabled={checkingWithdrawal}
                className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium bg-[oklch(0.16_0.01_260)] border border-[oklch(0.25_0.01_260)] text-[oklch(0.7_0.02_260)] hover:bg-[oklch(0.2_0.015_260)] transition-colors disabled:opacity-50"
              >
                {checkingWithdrawal ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Verificar Saque
              </button>

              {session.withdrawalStatus === "requires_approval" && (
                <button
                  onClick={handleRequestApproval}
                  disabled={requestingApproval}
                  className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
                >
                  {requestingApproval ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Solicitar Aprovação
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WITHDRAWAL UNAVAILABLE ALERT */}
      {withdrawalUnavailable && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <Ban className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h4 className="text-[13px] font-semibold text-red-400">Saque Indisponível</h4>
              <p className="text-[11px] text-red-300/70 mt-1 leading-relaxed">
                O sistema de saque está temporariamente indisponível. Isso pode ocorrer quando o servidor do SEOFast
                está em manutenção ou quando há restrições na conta. Tente novamente mais tarde.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* WITHDRAWAL FORM */}
      {isConnected && (
        <div className="rounded-lg border border-[oklch(0.22_0.01_260)] bg-[oklch(0.13_0.008_260)]">
          <div className="px-5 py-3.5 border-b border-[oklch(0.2_0.01_260)]">
            <h3 className="text-[13px] font-semibold text-foreground">Executar Saque</h3>
          </div>
          <div className="p-5">
            <form onSubmit={handleSubmitWithdrawal} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-semibold text-[oklch(0.5_0.01_260)] uppercase tracking-widest mb-1.5 block">
                  Valor (RUB)
                </label>
                <Input
                  type="number"
                  min="30"
                  max="10000"
                  placeholder="30"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isRunning}
                  className="h-9 bg-[oklch(0.1_0.005_260)] border-[oklch(0.22_0.01_260)] text-foreground text-[13px] font-mono rounded-md"
                />
              </div>

              <Button
                type="submit"
                disabled={isRunning || session.withdrawalStatus === "pending" || withdrawalUnavailable}
                className={`w-full h-10 font-semibold text-[12px] rounded-md transition-all ${
                  withdrawalUnavailable
                    ? "bg-red-500/10 border border-red-500/20 text-red-400 cursor-not-allowed"
                    : "bg-[oklch(0.25_0.02_250)] hover:bg-[oklch(0.3_0.03_250)] text-[oklch(0.85_0.05_250)] border border-[oklch(0.35_0.04_250)]"
                }`}
              >
                {isRunning ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Processando... ({processingTime}s)</span>
                  </div>
                ) : withdrawalUnavailable ? (
                  <div className="flex items-center gap-2">
                    <Ban className="w-3.5 h-3.5" />
                    <span>Saque Indisponível</span>
                  </div>
                ) : (
                  <span>Sacar ₽{amount || "30"}</span>
                )}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

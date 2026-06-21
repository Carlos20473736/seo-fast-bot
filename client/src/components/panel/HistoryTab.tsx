import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  History,
  Copy,
  CheckCircle,
  RefreshCw,
  Wallet,
  Loader2,
  DollarSign,
  LogIn,
  LogOut,
  Zap,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { io, type Socket } from "socket.io-client";

// ============================================================
// TYPES
// ============================================================

type SessionStatus = "connected" | "disconnected" | "connecting" | "error";
type WithdrawalAvailability = "available" | "requires_approval" | "pending" | "no_wallet" | "unknown";

interface SessionInfo {
  email: string;
  status: SessionStatus;
  balance: string;
  loginTime: number;
  lastActivity: number;
  withdrawalStatus?: WithdrawalAvailability;
  withdrawalMessage?: string;
  message?: string;
}

// ============================================================
// STATUS BADGES
// ============================================================

function getStatusBadge(status: string) {
  switch (status) {
    case "ativada":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
          Ativada
        </Badge>
      );
    case "pendente":
      return (
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
          Pendente
        </Badge>
      );
    case "falhou":
      return (
        <Badge className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">
          Falhou
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getSessionBadge(info: SessionInfo | undefined) {
  if (!info) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
        Desconectado
      </span>
    );
  }

  switch (info.status) {
    case "connecting":
      return (
        <div className="flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
          <span className="text-xs text-blue-400">Conectando...</span>
        </div>
      );
    case "connected":
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-medium text-emerald-400">Conectado</span>
          </div>
          {info.balance && info.balance !== "0" && info.balance !== "0.00" && (
            <span className="text-sm font-bold text-emerald-300 pl-3">
              ₽ {info.balance}
            </span>
          )}
        </div>
      );
    case "error":
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-xs text-red-400">Erro</span>
          </div>
          {info.message && (
            <span className="text-[10px] text-red-400/70 pl-3 max-w-[120px] truncate" title={info.message}>
              {info.message}
            </span>
          )}
        </div>
      );
    default:
      return (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
          Desconectado
        </span>
      );
  }
}

function getWithdrawalBadge(status: WithdrawalAvailability | undefined) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  switch (status) {
    case "available":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
          <Wallet className="w-3 h-3 mr-1" />
          Disponível
        </Badge>
      );
    case "requires_approval":
      return (
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
          Requer Aprovação
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20">
          Pendente
        </Badge>
      );
    case "no_wallet":
      return (
        <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/20">
          Sem Carteira
        </Badge>
      );
    default:
      return <span className="text-xs text-muted-foreground">—</span>;
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function HistoryTab() {
  const { data: accounts, isLoading } = trpc.accounts.list.useQuery();
  const [copied, setCopied] = useState(false);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({});
  const [loginQueue, setLoginQueue] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();

  // ============================================================
  // SOCKET CONNECTION (persistent for this tab)
  // ============================================================

  useEffect(() => {
    const socketUrl = window.location.origin;
    const s: Socket = io(socketUrl, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      console.log("[HistoryTab] Socket connected");
    });

    s.on("session_update", (data: SessionInfo) => {
      setSessions((prev) => ({
        ...prev,
        [data.email]: data,
      }));

      if (data.status === "connected") {
        toast.success(`${data.email}: Conectado | Saldo: ₽${data.balance}`);
      } else if (data.status === "error") {
        toast.error(`${data.email}: ${data.message || "Erro no login"}`);
      }
    });

    s.on("balance_update", (data: { email: string; balance: string; success: boolean }) => {
      if (data.success) {
        setSessions((prev) => ({
          ...prev,
          [data.email]: {
            ...prev[data.email],
            balance: data.balance,
            lastActivity: Date.now(),
          },
        }));
      }
    });

    s.on("withdrawal_status", (data: { email: string; status: WithdrawalAvailability; balance: string; message: string }) => {
      setSessions((prev) => ({
        ...prev,
        [data.email]: {
          ...prev[data.email],
          balance: data.balance,
          withdrawalStatus: data.status,
          withdrawalMessage: data.message,
          lastActivity: Date.now(),
        },
      }));

      if (data.status === "available") {
        toast.success(`${data.email}: Saque disponível!`);
      } else if (data.status === "requires_approval") {
        toast.warning(`${data.email}: Requer aprovação`);
      }
    });

    s.on("approval_result", (data: { email: string; success: boolean; status: string; message: string }) => {
      if (data.success) {
        toast.success(`${data.email}: ${data.message}`);
        // Refresh withdrawal status
        const session = sessions[data.email];
        if (session) {
          setSessions((prev) => ({
            ...prev,
            [data.email]: { ...prev[data.email], withdrawalStatus: "available" },
          }));
        }
      } else {
        toast.warning(`${data.email}: ${data.message}`);
      }
    });

    socketRef.current = s;

    return () => {
      s.disconnect();
      socketRef.current = null;
      if (loginTimerRef.current) clearTimeout(loginTimerRef.current);
    };
  }, []);

  // ============================================================
  // LOGIN QUEUE PROCESSOR (ref-based to avoid re-render loops)
  // ============================================================

  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  const processNextInQueue = useCallback(() => {
    if (processingRef.current) return;
    if (queueRef.current.length === 0) return;

    processingRef.current = true;
    const next = queueRef.current.shift()!;
    const [email, password] = next.split("|||");

    if (email && password && socketRef.current) {
      setSessions((prev) => ({
        ...prev,
        [email]: { email, status: "connecting", balance: "0", loginTime: 0, lastActivity: 0 },
      }));
      socketRef.current.emit("seofast_login", { email, password });
    }

    // Wait 4s before processing next item
    loginTimerRef.current = setTimeout(() => {
      processingRef.current = false;
      processNextInQueue();
    }, 4000);
  }, []);

  // When loginQueue state changes, copy to ref and start processing
  useEffect(() => {
    if (loginQueue.length > 0) {
      queueRef.current = [...loginQueue];
      setLoginQueue([]);
      processNextInQueue();
    }
  }, [loginQueue, processNextInQueue]);

  // ============================================================
  // HANDLERS
  // ============================================================

  const handleLogin = useCallback((email: string, password: string) => {
    if (!socketRef.current) return;

    setSessions((prev) => ({
      ...prev,
      [email]: { email, status: "connecting", balance: "0", loginTime: 0, lastActivity: 0 },
    }));
    socketRef.current.emit("seofast_login", { email, password });
  }, []);

  const handleLoginAll = useCallback(() => {
    if (!accounts) return;
    const seofastAccounts = accounts.filter(
      (a) => a.createSeofast === 1 && a.seofastStatus === "ativada" && a.seofastPassword
    );
    if (seofastAccounts.length === 0) {
      toast.info("Nenhuma conta SEOFast ativada para conectar");
      return;
    }
    toast.info(`Conectando a ${seofastAccounts.length} contas SEOFast...`);

    // Queue all logins
    const queue = seofastAccounts.map((a) => `${a.email}|||${a.seofastPassword}`);
    setLoginQueue(queue);
  }, [accounts]);

  const handleCheckWithdrawal = useCallback((email: string, password: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit("check_withdrawal_status", { email, password });
  }, []);

  const handleRequestApproval = useCallback((email: string, password: string) => {
    if (!socketRef.current) return;
    toast.info(`Solicitando aprovação para ${email}...`);
    socketRef.current.emit("seofast_request_approval", { email, password });
  }, []);

  const handleDisconnect = useCallback((email: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit("seofast_disconnect", { email });
    setSessions((prev) => {
      const copy = { ...prev };
      delete copy[email];
      return copy;
    });
  }, []);

  const handleDisconnectAll = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit("seofast_disconnect_all");
    setSessions({});
    toast.info("Todas as sessões desconectadas");
  }, []);

  const handleCopyAll = () => {
    if (!accounts || accounts.length === 0) return;
    const text = accounts
      .map((a) => `${a.username} | ${a.email} | ${a.password} | ${a.status}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Contas copiadas para a área de transferência");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReactivate = (email: string) => {
    setReactivating(email);
    toast.info(`Tentando reativar ${email}...`);

    const socketUrl = window.location.origin;
    const s = io(socketUrl, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      s.emit("reactivate_account", { email });
    });

    s.on("result", (data: { success: boolean; message: string }) => {
      if (data.success) {
        toast.success(data.message);
        utils.accounts.list.invalidate();
      } else {
        toast.error(data.message);
      }
      setReactivating(null);
      s.disconnect();
    });

    setTimeout(() => {
      if (reactivating === email) {
        setReactivating(null);
        s.disconnect();
      }
    }, 90000);
  };

  // ============================================================
  // COUNTS
  // ============================================================

  const connectedCount = Object.values(sessions).filter((s) => s.status === "connected").length;
  const totalSeofast = accounts?.filter((a) => a.createSeofast === 1 && a.seofastStatus === "ativada" && a.seofastPassword)?.length || 0;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-4 border-b border-border/60">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2.5 text-foreground">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 ring-1 ring-primary/30">
              <History className="w-4 h-4 text-primary" />
            </span>
            <span className="flex flex-col">
              <span className="text-base font-semibold">Contas Criadas</span>
              <span className="text-xs font-normal text-muted-foreground">
                {accounts && accounts.length > 0
                  ? `${accounts.length} registros | ${connectedCount}/${totalSeofast} conectadas`
                  : "Nenhum registro ainda"}
              </span>
            </span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {totalSeofast > 0 && (
              <>
                {connectedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnectAll}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1.5" />
                    Desconectar
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoginAll}
                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                >
                  <LogIn className="w-3.5 h-3.5 mr-1.5" />
                  Conectar Todas
                </Button>
              </>
            )}
            {accounts && accounts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyAll}
                className="border-border hover:bg-accent"
              >
                {copied ? (
                  <CheckCircle className="w-4 h-4 mr-1.5 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4 mr-1.5" />
                )}
                {copied ? "Copiado!" : "Copiar"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <div className="animate-pulse">Carregando...</div>
          </div>
        ) : !accounts || accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <History className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">Nenhuma conta criada</p>
            <p className="text-xs opacity-70 mt-1">As contas criadas aparecerão aqui</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent bg-secondary/40">
                  <TableHead className="text-muted-foreground font-medium">Usuário</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Email</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Senha</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="text-muted-foreground font-medium">SEOFast</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Sessão / Saldo</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Saque</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Data</TableHead>
                  <TableHead className="text-muted-foreground font-medium w-[160px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const sessionInfo = sessions[account.email];
                  const canConnect = account.createSeofast === 1 && account.seofastStatus === "ativada" && account.seofastPassword;
                  const isConnected = sessionInfo?.status === "connected";
                  const isConnecting = sessionInfo?.status === "connecting";

                  return (
                    <TableRow key={account.id} className="border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-sm text-foreground">
                        {account.username}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-foreground max-w-[180px] truncate" title={account.email}>
                        {account.email}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-foreground">
                        {account.password}
                      </TableCell>
                      <TableCell>{getStatusBadge(account.status)}</TableCell>
                      <TableCell>
                        {account.createSeofast === 1
                          ? getStatusBadge(account.seofastStatus)
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {canConnect ? getSessionBadge(sessionInfo) : <span className="text-xs text-muted-foreground">N/A</span>}
                      </TableCell>
                      <TableCell>
                        {canConnect && isConnected
                          ? getWithdrawalBadge(sessionInfo?.withdrawalStatus)
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(account.createdAt).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {/* Reactivate button */}
                          {(account.status === "pendente" || account.status === "falhou") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReactivate(account.email)}
                              disabled={reactivating === account.email}
                              className="h-7 px-2 text-xs hover:bg-accent"
                              title="Tentar reativar via IMAP"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${reactivating === account.email ? "animate-spin" : ""}`}
                              />
                            </Button>
                          )}

                          {/* Connect / Disconnect button */}
                          {canConnect && !isConnected && !isConnecting && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleLogin(account.email, account.seofastPassword!)}
                              className="h-7 px-2 text-xs hover:bg-emerald-500/10 text-emerald-400"
                              title="Conectar à conta SEOFast"
                            >
                              <LogIn className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {canConnect && isConnecting && (
                            <Button variant="ghost" size="sm" disabled className="h-7 px-2 text-xs">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </Button>
                          )}

                          {canConnect && isConnected && (
                            <>
                              {/* Check withdrawal */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCheckWithdrawal(account.email, account.seofastPassword!)}
                                className="h-7 px-2 text-xs hover:bg-accent"
                                title="Verificar disponibilidade de saque"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                              </Button>

                              {/* Request approval (only if requires_approval) */}
                              {sessionInfo?.withdrawalStatus === "requires_approval" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRequestApproval(account.email, account.seofastPassword!)}
                                  className="h-7 px-2 text-xs hover:bg-amber-500/10 text-amber-400"
                                  title="Solicitar aprovação de saque"
                                >
                                  <Zap className="w-3.5 h-3.5" />
                                </Button>
                              )}

                              {/* Disconnect */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDisconnect(account.email)}
                                className="h-7 px-2 text-xs hover:bg-red-500/10 text-red-400"
                                title="Desconectar sessão"
                              >
                                <LogOut className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

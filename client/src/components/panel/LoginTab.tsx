import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, LogIn, ShieldCheck, KeyRound, CheckCircle2, XCircle } from "lucide-react";

const LOGIN_DRAFT_KEY = "faucetpay_login_draft";

export interface FaucetPayLoginResult {
  success: boolean;
  message: string;
  token?: string;
  etag?: string;
  authorized?: boolean;
  twoFaRequired?: boolean;
  twoFaType?: string;
  cookies?: string;
  user?: unknown;
}

interface LoginTabProps {
  onSubmit: (data: { email: string; password: string; twoFaCode?: string }) => void;
  isRunning: boolean;
  result: FaucetPayLoginResult | null;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(LOGIN_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(data: { email: string; password: string }) {
  try {
    localStorage.setItem(LOGIN_DRAFT_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export default function LoginTab({ onSubmit, isRunning, result }: LoginTabProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFaCode, setTwoFaCode] = useState("");

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      if (draft.email) setEmail(draft.email);
      if (draft.password) setPassword(draft.password);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (email || password) saveDraft({ email, password });
    }, 500);
    return () => clearTimeout(timer);
  }, [email, password]);

  // When the backend reports a pending 2FA, prompt the user for the code.
  const needsCode = result?.twoFaRequired === true && result?.success === false;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    onSubmit({ email, password, twoFaCode: twoFaCode.trim() || undefined });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[oklch(0.22_0.01_260)] bg-[oklch(0.13_0.008_260)]">
        <div className="px-5 py-3.5 border-b border-[oklch(0.2_0.01_260)] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[oklch(0.7_0.18_250)]" />
          <h3 className="text-[13px] font-semibold text-foreground">Login FaucetPay</h3>
        </div>
        <div className="p-5">
          <p className="text-[11px] text-[oklch(0.5_0.01_260)] mb-4 leading-relaxed">
            Autentica na FaucetPay com e-mail e senha, resolvendo automaticamente o desafio anti-bot
            (basilisk). Se a conta exigir verificação em duas etapas por e-mail, o código pode ser lido
            automaticamente (via IMAP configurado em Configurações) ou informado manualmente abaixo.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="text-[10px] font-semibold text-[oklch(0.5_0.01_260)] uppercase tracking-widest mb-1.5 block">
                Email
              </label>
              <Input
                type="email"
                placeholder="conta@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isRunning}
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
                placeholder="Senha FaucetPay"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isRunning}
                className="h-9 bg-[oklch(0.1_0.005_260)] border-[oklch(0.22_0.01_260)] text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-[13px] rounded-md"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[oklch(0.5_0.01_260)] uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" />
                Código 2FA (opcional)
              </label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Código por e-mail (se solicitado)"
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value)}
                disabled={isRunning}
                className={`h-9 bg-[oklch(0.1_0.005_260)] border-[oklch(0.22_0.01_260)] text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-[13px] rounded-md ${
                  needsCode ? "border-amber-500/40" : ""
                }`}
              />
              {needsCode && (
                <p className="text-[10px] text-amber-400 mt-1.5">
                  Verificação 2FA necessária. Informe o código recebido por e-mail e envie novamente.
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isRunning || !email || !password}
              className="w-full h-9 bg-[oklch(0.25_0.02_250)] hover:bg-[oklch(0.3_0.03_250)] text-[oklch(0.85_0.05_250)] border border-[oklch(0.35_0.04_250)] font-medium text-[12px] rounded-md"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Autenticando...
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 mr-2" />
                  Entrar
                </>
              )}
            </Button>
          </form>
        </div>
      </div>

      {result && (
        <div
          className={`rounded-lg border p-4 ${
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
            {result.success ? "Login concluído" : "Falha no login"}
          </h3>
          <p className="text-[12px] text-muted-foreground">{result.message}</p>
          {result.success && (
            <div className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] border-t border-border/40 pt-3">
              <Row label="Autorizado" value={result.authorized ? "Sim" : "Pendente 2FA"} />
              {result.token && <Row label="Token" value={`${result.token.slice(0, 16)}…`} />}
              {result.etag && <Row label="Etag" value={`${result.etag.slice(0, 16)}…`} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[oklch(0.5_0.01_260)]">{label}</span>
      <span className="text-foreground font-mono truncate text-[11px]">{value}</span>
    </div>
  );
}

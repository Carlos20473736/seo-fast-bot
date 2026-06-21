import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Shuffle, KeyRound, Globe, RotateCcw } from "lucide-react";

interface Props {
  onSubmit: (data: {
    username: string;
    email: string;
    password: string;
    referrer?: string;
    createSeofast?: boolean;
  }) => void;
  isRunning: boolean;
}

const WORDS = [
  "crypto", "moon", "hodl", "satoshi", "block", "chain", "defi", "nft",
  "whale", "bull", "bear", "pump", "gem", "alpha", "degen", "ape",
];

const STORAGE_KEY = "faucetpay_create_account_draft";

interface DraftData {
  username: string;
  email: string;
  password: string;
  referrer: string;
  createSeofast: boolean;
  savedAt: number;
}

function generateRandomUsername() {
  const word1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const word2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  const raw = `${word1}${word2}${num}`;
  return raw.slice(0, 13);
}

function generateRandomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const specials = "!@#$%&*";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const pos1 = Math.floor(Math.random() * password.length);
  password = password.slice(0, pos1) + specials.charAt(Math.floor(Math.random() * specials.length)) + password.slice(pos1);
  const pos2 = Math.floor(Math.random() * password.length);
  password = password.slice(0, pos2) + specials.charAt(Math.floor(Math.random() * specials.length)) + password.slice(pos2);
  return password;
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as DraftData;
    if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveDraft(data: Omit<DraftData, "savedAt">) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {}
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export default function CreateAccountTab({ onSubmit, isRunning }: Props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referrer, setReferrer] = useState("");
  const [createSeofast, setCreateSeofast] = useState(true);
  const [existingAccount, setExistingAccount] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setUsername(draft.username);
      setEmail(draft.email);
      setPassword(draft.password);
      setReferrer(draft.referrer);
      setCreateSeofast(draft.createSeofast);
      if (draft.existingAccount !== undefined) setExistingAccount(draft.existingAccount);
      setHasDraft(true);
    }
  }, []);

  const autoSave = useCallback(() => {
    if (username || email || password) {
      saveDraft({ username, email, password, referrer, createSeofast, existingAccount });
      setHasDraft(true);
    }
  }, [username, email, password, referrer, createSeofast, existingAccount]);

  useEffect(() => {
    const timer = setTimeout(autoSave, 500);
    return () => clearTimeout(timer);
  }, [autoSave]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) return;
    onSubmit({ username, email, password, referrer: referrer || undefined, createSeofast, existingAccount });
  };

  const handleRandomUsername = () => setUsername(generateRandomUsername());
  const handleRandomPassword = () => setPassword(generateRandomPassword());

  const handleClearDraft = () => {
    setUsername("");
    setEmail("");
    setPassword("");
    setReferrer("");
    setCreateSeofast(true);
    clearDraft();
    setHasDraft(false);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">Nova Conta</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Preencha os dados para iniciar</p>
        </div>
        {hasDraft && (
          <span className="text-[10px] font-medium text-[oklch(0.7_0.18_250)] bg-[oklch(0.7_0.18_250)]/10 px-2 py-0.5 rounded-full">
            Rascunho salvo
          </span>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Username */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Username <span className="opacity-50">(max 13)</span>
          </label>
          <div className="flex gap-2 relative">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.slice(0, 13))}
              placeholder="Nome de usuário"
              maxLength={13}
              className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.4_0.01_260)] text-sm"
              required
            />
            <span className={`text-[10px] absolute -bottom-3.5 left-0 ${username.length >= 13 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {username.length}/13
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleRandomUsername}
              className="h-9 w-9 shrink-0 border-border bg-[oklch(0.14_0.008_260)] hover:bg-[oklch(0.2_0.01_260)]"
              title="Gerar aleatório"
            >
              <Shuffle className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Email
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@exemplo.com"
            className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.4_0.01_260)] text-sm"
            required
          />
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Senha
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.4_0.01_260)] text-sm font-mono"
              required
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleRandomPassword}
              className="h-9 w-9 shrink-0 border-border bg-[oklch(0.14_0.008_260)] hover:bg-[oklch(0.2_0.01_260)]"
              title="Gerar senha"
            >
              <KeyRound className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Referrer */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Referrer <span className="opacity-50">(opcional)</span>
          </label>
          <Input
            value={referrer}
            onChange={(e) => setReferrer(e.target.value)}
            placeholder="Username do referenciador"
            className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.4_0.01_260)] text-sm"
          />
        </div>

        {/* Existing Account toggle */}
        <label
          htmlFor="existingAccount"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
            existingAccount
              ? "bg-amber-500/5 border-amber-500/30"
              : "bg-[oklch(0.14_0.008_260)] border-border hover:border-amber-500/20"
          }`}
        >
          <input
            id="existingAccount"
            type="checkbox"
            checked={existingAccount}
            onChange={(e) => setExistingAccount(e.target.checked)}
            className="w-4 h-4 accent-amber-500 rounded"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Conta FaucetPay já existe</p>
            <p className="text-[10px] text-muted-foreground">Pula captcha/registro e vai direto pro SEOFast</p>
          </div>
        </label>

        {/* SEOFast toggle */}
        <label
          htmlFor="createSeofast"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${
            createSeofast
              ? "bg-[oklch(0.7_0.18_250)]/5 border-[oklch(0.7_0.18_250)]/30"
              : "bg-[oklch(0.14_0.008_260)] border-border hover:border-[oklch(0.7_0.18_250)]/20"
          }`}
        >
          <input
            id="createSeofast"
            type="checkbox"
            checked={createSeofast}
            onChange={(e) => setCreateSeofast(e.target.checked)}
            className="w-4 h-4 accent-[oklch(0.7_0.18_250)] rounded"
          />
          <Globe className={`w-4 h-4 ${createSeofast ? "text-[oklch(0.7_0.18_250)]" : "text-muted-foreground"}`} />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Criar conta SEOFast</p>
            <p className="text-[10px] text-muted-foreground">Registra e vincula carteira automaticamente</p>
          </div>
        </label>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            disabled={isRunning || !username || !email || !password}
            className="flex-1 h-10 bg-[oklch(0.7_0.18_250)] hover:bg-[oklch(0.65_0.18_250)] text-[oklch(0.12_0.01_260)] font-semibold text-sm rounded-lg transition-all"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : existingAccount ? (
              "Vincular Conta"
            ) : (
              "Iniciar Criação"
            )}
          </Button>
          {hasDraft && !isRunning && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleClearDraft}
              className="h-10 w-10 shrink-0 border-border hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
              title="Limpar formulário"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

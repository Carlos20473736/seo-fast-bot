import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Save, Eye, EyeOff, Loader2, CheckCircle, XCircle, Wifi } from "lucide-react";
import { toast } from "sonner";

const SETTINGS_STORAGE_KEY = "faucetpay_settings_draft";

interface SettingsDraft {
  openaiKey: string;
  gmailEmail: string;
  gmailPassword: string;
  gmailAccountPassword: string;
  proxyEnabled: boolean;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
}

function loadSettingsDraft(): SettingsDraft | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSettingsDraft(data: SettingsDraft) {
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data)); } catch {}
}

export default function SettingsTab() {
  const { data: config, isLoading } = trpc.config.get.useQuery();
  const updateConfig = trpc.config.update.useMutation({
    onSuccess: () => {
      toast.success("Configurações salvas com sucesso!");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      toast.error(`Erro ao salvar: ${err.message}`);
    },
  });

  const testImap = trpc.config.testImap.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setImapStatus({ success: true, message: data.message });
      } else {
        toast.error(data.details || data.message);
        setImapStatus({ success: false, message: data.details || data.message });
      }
    },
    onError: (err) => {
      const friendly = "Não foi possível completar o teste IMAP. Verifique as credenciais.";
      toast.error(friendly);
      setImapStatus({ success: false, message: `${friendly} (${err.message})` });
    },
  });

  const [openaiKey, setOpenaiKey] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailAccountPassword, setGmailAccountPassword] = useState("");
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imapStatus, setImapStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Carregar draft salvo ao montar
  useEffect(() => {
    const draft = loadSettingsDraft();
    if (draft) {
      if (draft.openaiKey) setOpenaiKey(draft.openaiKey);
      if (draft.gmailEmail) setGmailEmail(draft.gmailEmail);
      if (draft.gmailPassword) setGmailPassword(draft.gmailPassword);
      if (draft.gmailAccountPassword) setGmailAccountPassword(draft.gmailAccountPassword);
      if (draft.proxyEnabled !== undefined) setProxyEnabled(draft.proxyEnabled);
      if (draft.proxyHost) setProxyHost(draft.proxyHost);
      if (draft.proxyPort) setProxyPort(draft.proxyPort);
      if (draft.proxyUsername) setProxyUsername(draft.proxyUsername);
      if (draft.proxyPassword) setProxyPassword(draft.proxyPassword);
    }
  }, []);

  // Preencher dados do servidor se não tiver draft
  useEffect(() => {
    if (config) {
      if (!gmailEmail) setGmailEmail(config.gmail_login_email || "");
      if (!proxyHost) setProxyHost(config.proxy_host || "");
      if (!proxyPort) setProxyPort(config.proxy_port || "");
      if (!proxyUsername) setProxyUsername(config.proxy_username || "");
      setProxyEnabled(config.proxy_enabled === "1");
    }
  }, [config]);

  // Auto-salvar draft quando campos mudam
  useEffect(() => {
    const timer = setTimeout(() => {
      saveSettingsDraft({ openaiKey, gmailEmail, gmailPassword, gmailAccountPassword, proxyEnabled, proxyHost, proxyPort, proxyUsername, proxyPassword });
    }, 500);
    return () => clearTimeout(timer);
  }, [openaiKey, gmailEmail, gmailPassword, gmailAccountPassword, proxyEnabled, proxyHost, proxyPort, proxyUsername, proxyPassword]);

  const handleSave = () => {
    const payload: Record<string, string> = {};
    if (openaiKey) payload.openai_api_key = openaiKey;
    if (gmailPassword) payload.gmail_app_password = gmailPassword;
    if (gmailEmail) payload.gmail_login_email = gmailEmail;
    if (gmailAccountPassword) payload.gmail_password = gmailAccountPassword;
    payload.proxy_enabled = proxyEnabled ? "1" : "0";
    if (proxyHost) payload.proxy_host = proxyHost;
    if (proxyPort) payload.proxy_port = proxyPort;
    if (proxyUsername) payload.proxy_username = proxyUsername;
    if (proxyPassword) payload.proxy_password = proxyPassword;

    if (Object.keys(payload).length === 0) {
      toast.info("Nenhuma alteração para salvar");
      return;
    }
    updateConfig.mutate(payload);
  };

  const handleTestImap = () => {
    setImapStatus(null);
    testImap.mutate({
      email: gmailEmail || undefined,
      password: gmailPassword || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[oklch(0.5_0.01_260)]">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* OpenAI */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">OpenAI</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Resolução de captcha com GPT-4o-mini</p>
          </div>
          <button
            onClick={() => setShowKeys(!showKeys)}
            className="text-[oklch(0.5_0.01_260)] hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-[oklch(0.18_0.01_260)]"
            title={showKeys ? "Ocultar chaves" : "Mostrar chaves"}
          >
            {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="p-5">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              API Key
            </label>
            <Input
              type={showKeys ? "text" : "password"}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={config?.has_openai_key ? "••••••••••••••••••••" : "sk-proj-..."}
              className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-sm font-mono"
            />
            {config?.has_openai_key && (
              <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1">
                <CheckCircle className="w-3 h-3" />
                Chave configurada
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Gmail / IMAP */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">Gmail / IMAP</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Leitura dos e-mails de confirmação</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Email de Login
            </label>
            <Input
              type="email"
              value={gmailEmail}
              onChange={(e) => setGmailEmail(e.target.value)}
              placeholder="seu-email@gmail.com"
              className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-sm"
            />
            <p className="text-[10px] text-[oklch(0.4_0.01_260)]">
              Mesmo email que recebe as confirmações do FaucetPay
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Senha do Gmail
            </label>
            <Input
              type={showKeys ? "text" : "password"}
              value={gmailAccountPassword}
              onChange={(e) => setGmailAccountPassword(e.target.value)}
              placeholder={config?.has_gmail_account_password ? "••••••••••••" : "Senha da conta Gmail"}
              className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-sm"
            />
            {config?.has_gmail_account_password && (
              <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1">
                <CheckCircle className="w-3 h-3" />
                Senha configurada
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              App Password
            </label>
            <Input
              type={showKeys ? "text" : "password"}
              value={gmailPassword}
              onChange={(e) => setGmailPassword(e.target.value)}
              placeholder={config?.has_gmail_password ? "••••••••••••" : "xxxx xxxx xxxx xxxx"}
              className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground placeholder:text-[oklch(0.35_0.01_260)] text-sm font-mono"
            />
            {config?.has_gmail_password && (
              <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1">
                <CheckCircle className="w-3 h-3" />
                App Password configurada
              </p>
            )}
            <p className="text-[10px] text-[oklch(0.4_0.01_260)]">
              Gere em: myaccount.google.com/apppasswords (requer 2FA ativo)
            </p>
          </div>

          {/* Test IMAP */}
          <div className="pt-3 border-t border-border/40">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestImap}
              disabled={testImap.isPending}
              className="h-8 text-xs border-border hover:bg-[oklch(0.18_0.01_260)]"
            >
              {testImap.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Testando...
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 mr-1.5" />
                  Testar Conexão IMAP
                </>
              )}
            </Button>
            {imapStatus && (
              <p className={`text-[11px] mt-2 flex items-center gap-1 ${
                imapStatus.success ? "text-emerald-400" : "text-red-400"
              }`}>
                {imapStatus.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {imapStatus.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Proxy DataImpulse */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">Proxy (DataImpulse)</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">IP fixo por conta (sessid) para todas as operações</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-[11px] font-medium text-muted-foreground">Ativo</span>
            <input
              type="checkbox"
              checked={proxyEnabled}
              onChange={(e) => setProxyEnabled(e.target.checked)}
              className="w-4 h-4 accent-[oklch(0.7_0.18_250)] rounded"
            />
          </label>
        </div>
        {proxyEnabled && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Host</label>
                <Input
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  placeholder="gw.dataimpulse.com"
                  className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Porta</label>
                <Input
                  value={proxyPort}
                  onChange={(e) => setProxyPort(e.target.value)}
                  placeholder="823"
                  className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Usuário</label>
              <Input
                value={proxyUsername}
                onChange={(e) => setProxyUsername(e.target.value)}
                placeholder="2967368d437d02bb56af"
                className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Senha</label>
              <Input
                type={showKeys ? "text" : "password"}
                value={proxyPassword}
                onChange={(e) => setProxyPassword(e.target.value)}
                placeholder={config?.has_proxy_password ? "••••••••••••" : "Senha do proxy"}
                className="h-9 bg-[oklch(0.14_0.008_260)] border-border text-foreground text-sm font-mono"
              />
              {config?.has_proxy_password && (
                <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-1">
                  <CheckCircle className="w-3 h-3" />
                  Senha configurada
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={updateConfig.isPending}
        className="w-full h-10 bg-[oklch(0.7_0.18_250)] hover:bg-[oklch(0.65_0.18_250)] text-[oklch(0.12_0.01_260)] font-semibold text-sm rounded-lg"
      >
        {updateConfig.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Salvando...
          </>
        ) : saved ? (
          <>
            <CheckCircle className="w-4 h-4 mr-2" />
            Salvo
          </>
        ) : (
          <>
            <Save className="w-4 h-4 mr-2" />
            Salvar Configurações
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * DataImpulse proxy integration.
 *
 * Centraliza a configuração do proxy para que TODAS as operações de rede do
 * sistema (criação de conta FaucetPay, login, fluxo SEOFast e saques) passem
 * pelo mesmo IP.
 *
 * Estratégia de IP fixo por conta:
 *   - Usamos o recurso `sessid` do DataImpulse (login__sessid.<id>) que mantém
 *     o mesmo IP por ~30 minutos para um mesmo identificador.
 *   - Cada conta (derivada do e-mail) gera um `sessid` estável, garantindo que
 *     captcha -> registro -> ativação -> SEOFast -> saque de UMA conta usem o
 *     mesmo IP de saída.
 *
 * Protocolo: HTTPS (o gateway aceita conexão TLS na porta 823).
 *   - curl -x "https://user:pass@gw.dataimpulse.com:823" https://api.ipify.org
 *
 * Host padrão: gw.dataimpulse.com
 */

import crypto from "crypto";
import https from "https";
import tls from "tls";
import net from "net";
import { ProxyAgent, fetch as undiciFetch } from "undici";

// ============================================================
// CONFIG
// ============================================================

export interface ProxyConfig {
  enabled: boolean;
  /** "https" (padrão, recomendado pelo provedor) ou "http". */
  scheme: "https" | "http";
  host: string;
  port: number;
  username: string;
  password: string;
  /** Código(s) de país opcional(is), ex.: "us" ou "us,de". */
  country?: string;
}

/**
 * Credenciais padrão (DataImpulse) — fornecidas pelo usuário.
 * Podem ser sobrescritas pelo banco (app_config) ou variáveis de ambiente.
 */
const DEFAULT_PROXY: ProxyConfig = {
  enabled: true,
  scheme: "https",
  host: "gw.dataimpulse.com",
  port: 823,
  username: "2967368d437d02bb56af",
  password: "3b18fb1b5b851ce5",
  country: "",
};

/**
 * Lê a configuração de proxy a partir de um dicionário de config (app_config)
 * combinado com as variáveis de ambiente, caindo nos valores padrão quando
 * nada for informado.
 */
export function resolveProxyConfig(config: Record<string, string> = {}): ProxyConfig {
  const enabledRaw =
    config.proxy_enabled ?? process.env.PROXY_ENABLED ?? (DEFAULT_PROXY.enabled ? "1" : "0");
  const enabled = enabledRaw === "1" || enabledRaw === "true";

  const scheme = (config.proxy_scheme || process.env.PROXY_SCHEME || DEFAULT_PROXY.scheme) as
    | "https"
    | "http";

  return {
    enabled,
    scheme: scheme === "http" ? "http" : "https",
    host: config.proxy_host || process.env.PROXY_HOST || DEFAULT_PROXY.host,
    port: parseInt(config.proxy_port || process.env.PROXY_PORT || String(DEFAULT_PROXY.port), 10),
    username: config.proxy_username || process.env.PROXY_USERNAME || DEFAULT_PROXY.username,
    password: config.proxy_password || process.env.PROXY_PASSWORD || DEFAULT_PROXY.password,
    country: config.proxy_country || process.env.PROXY_COUNTRY || DEFAULT_PROXY.country || "",
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Gera um identificador de sessão estável (sessid) a partir de uma "âncora"
 * (geralmente o e-mail da conta). O mesmo input produz sempre o mesmo sessid,
 * garantindo IP consistente para todo o ciclo de vida daquela conta.
 */
export function sessionIdFor(anchor: string): string {
  return crypto.createHash("md5").update(anchor).digest("hex").slice(0, 12);
}

/**
 * Monta o "username" do proxy incluindo os parâmetros de targeting do
 * DataImpulse: país (cr) e sessão fixa (sessid).
 *
 *   usuario__cr.us;sessid.<id>
 */
function buildProxyUsername(cfg: ProxyConfig, sessionAnchor?: string): string {
  const parts: string[] = [];
  if (cfg.country) parts.push(`cr.${cfg.country}`);
  if (sessionAnchor) parts.push(`sessid.${sessionIdFor(sessionAnchor)}`);

  if (parts.length === 0) return cfg.username;
  return `${cfg.username}__${parts.join(";")}`;
}

/**
 * Monta a URL completa do proxy (https://user:pass@host:port).
 */
export function buildProxyUrl(cfg: ProxyConfig, sessionAnchor?: string): string {
  const user = encodeURIComponent(buildProxyUsername(cfg, sessionAnchor));
  const pass = encodeURIComponent(cfg.password);
  return `${cfg.scheme}://${user}:${pass}@${cfg.host}:${cfg.port}`;
}

// ============================================================
// FETCH (engine FaucetPay / basilisk captcha)
// ============================================================

/**
 * `fetch` com proxy DataImpulse aplicado, usando o `fetch` do undici junto do
 * ProxyAgent (mais confiável que o fetch global do Node para tunneling HTTPS).
 * Quando o proxy está desabilitado, faz fetch direto pelo global.
 *
 * Drop-in replacement do fetch nativo para o engine.
 */
export async function proxyFetch(
  cfg: ProxyConfig,
  sessionAnchor: string | undefined,
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  if (!cfg.enabled) {
    return fetch(input, init);
  }

  const proxyUrl = buildProxyUrl(cfg, sessionAnchor);
  const dispatcher = new ProxyAgent({
    uri: proxyUrl,
    proxyTls: { rejectUnauthorized: false, servername: cfg.host },
    requestTls: { rejectUnauthorized: false },
  });

  // undiciFetch tem assinatura compatível com o fetch padrão usado no engine.
  // @ts-ignore - tipos do undici diferem ligeiramente do lib.dom fetch.
  return undiciFetch(input, { ...init, dispatcher });
}

// ============================================================
// AGENT para https.request (cliente HTTP do SEOFast)
// ============================================================

/**
 * Cria um https.Agent que tunela toda conexão pelo proxy DataImpulse via
 * CONNECT, preservando as opções de TLS do destino (TLS1.2 + ciphers legados
 * usados pelo cliente SEOFast). Retorna `undefined` quando o proxy está
 * desabilitado (o chamador então usa o agent TLS direto).
 *
 * Implementação própria de CONNECT para suportar o gateway HTTPS do provedor
 * sem depender de pacotes externos adicionais.
 */
export function createProxyHttpsAgent(
  cfg: ProxyConfig,
  sessionAnchor: string | undefined,
  destTlsOptions: tls.ConnectionOptions = {}
): https.Agent | undefined {
  if (!cfg.enabled) return undefined;

  const proxyUser = buildProxyUsername(cfg, sessionAnchor);
  const auth = Buffer.from(`${proxyUser}:${cfg.password}`).toString("base64");

  class DataImpulseAgent extends https.Agent {
    // @ts-ignore - assinatura compatível em runtime
    createConnection(options: any, callback: (err: Error | null, socket?: any) => void) {
      const destHost = options.host;
      const destPort = options.port || 443;

      // 1) Abrir túnel TLS até o gateway do proxy (scheme https).
      const proxySocketFactory =
        cfg.scheme === "https"
          ? (cb: (s: net.Socket) => void) => {
              const s = tls.connect(
                {
                  host: cfg.host,
                  port: cfg.port,
                  rejectUnauthorized: false,
                  servername: cfg.host,
                },
                () => cb(s)
              );
              s.on("error", (e) => callback(e));
            }
          : (cb: (s: net.Socket) => void) => {
              const s = net.connect({ host: cfg.host, port: cfg.port }, () => cb(s));
              s.on("error", (e) => callback(e));
            };

      proxySocketFactory((proxySocket) => {
        // 2) Enviar CONNECT para o destino final.
        const connectReq =
          `CONNECT ${destHost}:${destPort} HTTP/1.1\r\n` +
          `Host: ${destHost}:${destPort}\r\n` +
          `Proxy-Authorization: Basic ${auth}\r\n` +
          `Proxy-Connection: Keep-Alive\r\n` +
          `\r\n`;
        proxySocket.write(connectReq);

        let buffer = "";
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          if (buffer.includes("\r\n\r\n")) {
            proxySocket.removeListener("data", onData);
            const statusLine = buffer.split("\r\n")[0] || "";
            if (!/ 200 /.test(statusLine)) {
              callback(new Error(`Proxy CONNECT falhou: ${statusLine.trim()}`));
              proxySocket.destroy();
              return;
            }
            // 3) Sobre o túnel, fazer o TLS com o destino final.
            const secured = tls.connect({
              socket: proxySocket,
              servername: destHost,
              rejectUnauthorized: false,
              ...destTlsOptions,
            });
            secured.on("secureConnect", () => callback(null, secured));
            secured.on("error", (e) => callback(e));
          }
        };
        proxySocket.on("data", onData);
        proxySocket.on("error", (e) => callback(e));
      });
    }
  }

  return new DataImpulseAgent({ keepAlive: true });
}

/**
 * Descrição curta para logs (sem expor a senha).
 */
export function proxyLabel(cfg: ProxyConfig, sessionAnchor?: string): string {
  if (!cfg.enabled) return "direto (sem proxy)";
  const sess = sessionAnchor ? ` sessid=${sessionIdFor(sessionAnchor)}` : "";
  const cr = cfg.country ? ` cr=${cfg.country}` : "";
  return `${cfg.scheme}://${cfg.host}:${cfg.port}${cr}${sess}`;
}

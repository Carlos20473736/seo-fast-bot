/**
 * SEOFast Auto Register Engine
 * Portado de faucetpay_seofast_registe.py (Fase 2)
 *
 * Fluxo:
 *  1. Registro desktop em seo-fast.ru/ajax/ajax_register.php
 *  2. Obter senha (resposta do registro ou via e-mail IMAP)
 *  3. Login mobile estilo APK 1.1.1 (device_id pro_, X-App-Token SHA-256,
 *     perfis PRO, hash_ajax, up_data)
 *  4. Login desktop em seo-fast.ru (sessão separada) + verificação de carteira
 *  5. Salvar carteira FaucetPay (purse_add, sys=faucetpay)
 */

import crypto from "crypto";
import https from "https";
import zlib from "zlib";
import { URLSearchParams } from "url";
import { CookieJar } from "tough-cookie";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmitFn, BrowserHeaders } from "./engine";
import { resolveProxyConfig, createProxyHttpsAgent, proxyLabel, type ProxyConfig } from "./proxy";

// ============================================================
// CONFIG - igual ao script Python
// ============================================================

const SEOFAST_URL = "https://seo-fast.ru";
const SEOFAST_MOBILE_URL = "https://seo-fast.bz/webapp/";
const SEOFAST_APP_VERSION = "1.1.1";
const SEOFAST_APP_SECRET = "seo_fast_SFk1gR5h5DGH";
const SEOFAST_PACKAGE_NAME = "com.example.seofast";

// Fallback UAs caso browserHeaders não seja fornecido
const FALLBACK_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const FALLBACK_MOBILE_UA =
  "Mozilla/5.0 (Android 12; Mobile; rv:151.0) Gecko/151.0 Firefox/151.0";
const FALLBACK_LANG = "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7";
const FALLBACK_CH_UA = '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"';
const FALLBACK_CH_MOBILE = "?0";
const FALLBACK_CH_PLATFORM = '"Windows"';

// Variável de módulo para armazenar os browserHeaders ativos neste ciclo
let _seofastBrowserHeaders: BrowserHeaders | undefined = undefined;

/** Retorna o User-Agent real do navegador ou fallback */
function getBrowserUA(): string {
  return _seofastBrowserHeaders?.["user-agent"] || FALLBACK_DESKTOP_UA;
}

/** Retorna o Accept-Language real do navegador ou fallback */
function getBrowserLang(): string {
  return _seofastBrowserHeaders?.["accept-language"] || FALLBACK_LANG;
}

/** Retorna sec-ch-ua real ou fallback */
function getBrowserChUa(): string {
  return _seofastBrowserHeaders?.["sec-ch-ua"] || FALLBACK_CH_UA;
}

/** Retorna sec-ch-ua-mobile real ou fallback */
function getBrowserChMobile(): string {
  return _seofastBrowserHeaders?.["sec-ch-ua-mobile"] || FALLBACK_CH_MOBILE;
}

/** Retorna sec-ch-ua-platform real ou fallback */
function getBrowserChPlatform(): string {
  return _seofastBrowserHeaders?.["sec-ch-ua-platform"] || FALLBACK_CH_PLATFORM;
}

// ============================================================
// PERFIS PRO DE DISPOSITIVOS (APK 1.1.1)
// ============================================================

interface DeviceProfile {
  hardware: {
    brand: string;
    model: string;
    device: string;
    hardware: string;
    manufacturer: string;
    product: string;
    board: string;
  };
  os: { sdk_int: number; release: string; incremental: string };
  display: { width_px: number; height_px: number; density_dpi: number; density: number };
  fingerprint: string;
  build_id: string;
  host: string;
}

const PRO_DEVICE_PROFILES: DeviceProfile[] = [
  {
    hardware: { brand: "samsung", model: "SM-S918B", device: "dm3q", hardware: "qcom", manufacturer: "samsung", product: "dm3qxxx", board: "kalama" },
    os: { sdk_int: 34, release: "14", incremental: "S918BXXS5CXK1" },
    display: { width_px: 1440, height_px: 3088, density_dpi: 600, density: 3.75 },
    fingerprint: "samsung/dm3qxxx/dm3q:14/UP1A.231005.007/S918BXXS5CXK1:user/release-keys",
    build_id: "UP1A.231005.007",
    host: "SWDG",
  },
  {
    hardware: { brand: "samsung", model: "SM-S928B", device: "e3q", hardware: "qcom", manufacturer: "samsung", product: "e3qxxx", board: "pineapple" },
    os: { sdk_int: 34, release: "14", incremental: "S928BXXS2AXL1" },
    display: { width_px: 1440, height_px: 3120, density_dpi: 600, density: 3.75 },
    fingerprint: "samsung/e3qxxx/e3q:14/UP1A.231005.007/S928BXXS2AXL1:user/release-keys",
    build_id: "UP1A.231005.007",
    host: "SWDH",
  },
  {
    hardware: { brand: "samsung", model: "SM-S911B", device: "dm1q", hardware: "qcom", manufacturer: "samsung", product: "dm1qxxx", board: "kalama" },
    os: { sdk_int: 34, release: "14", incremental: "S911BXXS5CXK2" },
    display: { width_px: 1080, height_px: 2340, density_dpi: 480, density: 3.0 },
    fingerprint: "samsung/dm1qxxx/dm1q:14/UP1A.231005.007/S911BXXS5CXK2:user/release-keys",
    build_id: "UP1A.231005.007",
    host: "SWDG",
  },
  {
    hardware: { brand: "google", model: "Pixel 8 Pro", device: "husky", hardware: "zuma", manufacturer: "Google", product: "husky", board: "zuma" },
    os: { sdk_int: 34, release: "14", incremental: "AP2A.240805.005" },
    display: { width_px: 1344, height_px: 2992, density_dpi: 560, density: 3.5 },
    fingerprint: "google/husky/husky:14/AP2A.240805.005/12025142:user/release-keys",
    build_id: "AP2A.240805.005",
    host: "abfarm",
  },
  {
    hardware: { brand: "google", model: "Pixel 9 Pro", device: "caiman", hardware: "zuma_pro", manufacturer: "Google", product: "caiman", board: "zuma_pro" },
    os: { sdk_int: 35, release: "15", incremental: "AP3A.241105.008" },
    display: { width_px: 1280, height_px: 2856, density_dpi: 560, density: 3.5 },
    fingerprint: "google/caiman/caiman:15/AP3A.241105.008/12485168:user/release-keys",
    build_id: "AP3A.241105.008",
    host: "abfarm",
  },
  {
    hardware: { brand: "samsung", model: "SM-F946B", device: "q5q", hardware: "qcom", manufacturer: "samsung", product: "q5qxxx", board: "kalama" },
    os: { sdk_int: 34, release: "14", incremental: "F946BXXS3CXK1" },
    display: { width_px: 1812, height_px: 2176, density_dpi: 480, density: 3.0 },
    fingerprint: "samsung/q5qxxx/q5q:14/UP1A.231005.007/F946BXXS3CXK1:user/release-keys",
    build_id: "UP1A.231005.007",
    host: "SWDI",
  },
  {
    hardware: { brand: "OnePlus", model: "CPH2581", device: "aston", hardware: "qcom", manufacturer: "OnePlus", product: "aston", board: "kalama" },
    os: { sdk_int: 34, release: "14", incremental: "A.16.0.0.203.CN" },
    display: { width_px: 1440, height_px: 3168, density_dpi: 560, density: 3.5 },
    fingerprint: "OnePlus/aston/aston:14/UKQ1.230924.001/A.16.0.0.203.CN:user/release-keys",
    build_id: "UKQ1.230924.001",
    host: "build",
  },
];

// ============================================================
// IDENTIDADE (APK d2/h.java + z1/r.java)
// ============================================================

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf-8").digest("hex");
}

function generateDeviceId(): string {
  const hexChars = "0123456789abcdef";
  let randomHash = "";
  for (let i = 0; i < 16; i++) randomHash += hexChars.charAt(Math.floor(Math.random() * 16));
  return `pro_${randomHash}`;
}

function generateAppToken(deviceId: string): string {
  return sha256Hex(`${deviceId}:${SEOFAST_PACKAGE_NAME}:${SEOFAST_APP_SECRET}`);
}

function getRandomProfile(): DeviceProfile {
  return PRO_DEVICE_PROFILES[Math.floor(Math.random() * PRO_DEVICE_PROFILES.length)];
}

function generateUserAgent(profile: DeviceProfile): string {
  const model = profile.hardware.model;
  const buildId = profile.build_id;
  const release = profile.os.release;
  return (
    `Mozilla/5.0 (Linux; Android ${release}; ${model} Build/${buildId}; wv) ` +
    `AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 ` +
    `Chrome/138.0.7204.179 Mobile Safari/537.36 SeoFast-App/1.0`
  );
}

function obfuscateEmail(emailAddr: string): string {
  if (!emailAddr || !emailAddr.includes("@")) return "u***r@gmail.com";
  const [local, domain] = emailAddr.split("@", 2);
  if (local.length <= 2) return `***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function generateDataJson(deviceId: string, profile: DeviceProfile, googleEmail: string): string {
  const brand = profile.hardware.brand.toLowerCase();
  let host: string;
  if (brand === "samsung") host = profile.host + String(Math.floor(1000 + Math.random() * 9000));
  else if (brand === "google") host = profile.host + String(Math.floor(100 + Math.random() * 900));
  else host = "build" + String(Math.floor(100 + Math.random() * 900));

  const data = {
    device_id: deviceId,
    device_type: "secure_device",
    is_emulator: false,
    is_secure: true,
    timestamp: Date.now(),
    emulator_type: "none",
    emulator_details: {
      build_properties: false,
      hardware: false,
      files: false,
      memu: false,
      bluestacks: false,
      nox: false,
      genymotion: false,
      google_emulator: false,
      masking_detected: false,
    },
    google_email: googleEmail,
    hardware: { ...profile.hardware },
    os: { ...profile.os },
    display: { ...profile.display },
    locale: { language: "pt", country: "BR", variant: "" },
    timezone: "America/Sao_Paulo",
    extra: {
      fingerprint: profile.fingerprint,
      tags: "release-keys",
      type: "user",
      user: "dpi",
      host,
    },
  };
  return JSON.stringify(data);
}

// ============================================================
// CLIENTE HTTP COM TLS 1.2 + COOKIES (replica TLSAdapter do Python)
// ============================================================

// Agent que força TLS 1.2 com ciphers legados e ignora verificação (igual ao Python).
const tlsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  // @ts-ignore - 'ciphers' aceito pelo TLS connect options
  ciphers: "DEFAULT@SECLEVEL=1",
});

interface HttpResponse {
  status: number;
  text: string;
  url: string;
}

/**
 * Cliente HTTP simples baseado em https nativo, com gestão de cookies via tough-cookie.
 * Necessário porque o fetch nativo (undici) não permite customizar o contexto TLS por request.
 */
class HttpClient {
  private jar = new CookieJar();
  private baseHeaders: Record<string, string>;
  /** Agent usado nas requisições. Por padrão o tlsAgent direto; pode ser um
   *  agent de proxy (DataImpulse) quando o proxy estiver habilitado. */
  private agent: https.Agent = tlsAgent;

  constructor(baseHeaders: Record<string, string> = {}, agent?: https.Agent) {
    this.baseHeaders = baseHeaders;
    if (agent) this.agent = agent;
  }

  setHeader(key: string, value: string) {
    this.baseHeaders[key] = value;
  }

  async getCookie(name: string, url: string): Promise<string | null> {
    const cookies = await this.jar.getCookies(url);
    const c = cookies.find((ck) => ck.key === name);
    return c ? c.value : null;
  }

  /**
   * Define um cookie manualmente no jar para um dado URL/domínio.
   */
  setCookie(name: string, value: string, url: string) {
    try {
      this.jar.setCookieSync(`${name}=${value}; path=/`, url);
    } catch {
      // ignora erros de cookie
    }
  }

  async request(
    method: "GET" | "POST",
    url: string,
    options: { headers?: Record<string, string>; body?: string; followRedirects?: boolean } = {}
  ): Promise<HttpResponse> {
    const followRedirects = options.followRedirects !== false;
    return this.doRequest(method, url, options.headers || {}, options.body, followRedirects, 0);
  }

  private doRequest(
    method: "GET" | "POST",
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    followRedirects: boolean,
    redirectCount: number
  ): Promise<HttpResponse> {
    return new Promise(async (resolve, reject) => {
      if (redirectCount > 8) {
        reject(new Error("Too many redirects"));
        return;
      }

      const cookieHeader = await this.jar.getCookieString(url);
      const finalHeaders: Record<string, string> = {
        ...this.baseHeaders,
        ...headers,
      };
      if (cookieHeader) finalHeaders["Cookie"] = cookieHeader;
      if (body !== undefined) {
        finalHeaders["Content-Length"] = Buffer.byteLength(body).toString();
      }

      const u = new URL(url);
      const req = https.request(
        {
          method,
          hostname: u.hostname,
          path: u.pathname + u.search,
          port: u.port || 443,
          headers: finalHeaders,
          agent: this.agent,
          timeout: 35000,
        },
        (res) => {
          // Persistir cookies
          const setCookies = res.headers["set-cookie"] || [];
          for (const sc of setCookies) {
            try {
              this.jar.setCookieSync(sc, url);
            } catch {
              // ignora cookies malformados
            }
          }

          // Redirecionamentos
          if (
            followRedirects &&
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const nextUrl = new URL(res.headers.location, url).toString();
            res.resume();
            // Redireciona como GET (comportamento padrão de navegador para 301/302)
            this.doRequest("GET", nextUrl, headers, undefined, followRedirects, redirectCount + 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            let text = "";
            
            try {
              const encoding = res.headers["content-encoding"] || "";
              if (encoding.includes("gzip")) {
                text = zlib.gunzipSync(buffer).toString("utf-8");
              } else if (encoding.includes("deflate")) {
                text = zlib.inflateSync(buffer).toString("utf-8");
              } else if (encoding.includes("br")) {
                text = zlib.brotliDecompressSync(buffer).toString("utf-8");
              } else {
                text = buffer.toString("utf-8");
              }
            } catch (e) {
              text = buffer.toString("utf-8");
            }

            resolve({
              status: res.statusCode || 0,
              text,
              url,
            });
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("Request timeout"));
      });

      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}

// ============================================================
// HEADERS MOBILE (APK WebView)
// ============================================================

function mobilePageHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "Upgrade-Insecure-Requests": "1",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "X-Requested-With": SEOFAST_PACKAGE_NAME,
    "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate",
    "sec-fetch-user": "?1",
    "sec-fetch-dest": "document",
  };
}

function mobileAjaxLoginHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Accept:
      "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01",
    Origin: "https://seo-fast.bz",
    Referer: "https://seo-fast.bz/webapp/?pg=login",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
}

function mobileAjaxJsonHeaders(referer = "https://seo-fast.bz/"): Record<string, string> {
  return {
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "Content-Type": "application/json; charset=utf-8",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json, text/plain, */*",
    Origin: "https://seo-fast.bz",
    Referer: referer,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
}

function profileAjaxHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "*/*",
    Origin: "https://seo-fast.bz",
    Referer: "https://seo-fast.bz/webapp/?pg=profile",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
}

// ============================================================
// HEADERS DESKTOP (seo-fast.ru) - para login e AJAX no domínio .ru
// ============================================================

/**
 * Headers para navegação de página HTML no desktop (GET de páginas como /login, /profile)
 * Usa Firefox/Android (consistente com a captura de tráfego que funciona)
 */
function desktopPageHeaders(referer?: string): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": getBrowserLang(),
    "accept-encoding": "gzip, deflate, br, zstd",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": getBrowserUA(),
    ...(referer ? { referer } : {}),
  };
}

/**
 * Headers para requisições AJAX no desktop (POST para ajax_profile.php, ajax_login.php)
 * Usa Firefox/Android com Origin/Referer para seo-fast.ru
 */
function desktopAjaxHeaders(referer: string = `${SEOFAST_URL}/profile`): Record<string, string> {
  return {
    accept: "*/*",
    "accept-language": getBrowserLang(),
    "accept-encoding": "gzip, deflate, br, zstd",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
    origin: SEOFAST_URL,
    referer,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": getBrowserUA(),
    "priority": "u=0",
    te: "trailers",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// IMAP - busca de e-mail (senha SEOFast e link de verificação)
// ============================================================

function extractEmailBody(html: string): string {
  return html;
}

/**
 * Conecta ao Gmail via IMAP e busca um e-mail que contenha um dos padrões de link/regex.
 * Retorna o primeiro match encontrado ou null.
 */
async function waitForEmailMatch(
  config: Record<string, string>,
  emit: EmitFn,
  opts: {
    fromFilters: string[];
    subjectFilters?: string[];
    patterns: RegExp[];
    maxWait?: number;
    checkInterval?: number;
  }
): Promise<string | null> {
  const loginEmail = config.gmail_login_email;
  const appPassword = config.gmail_app_password;
  if (!loginEmail || !appPassword) {
    emit.log("Credenciais Gmail não configuradas!", "error");
    return null;
  }

  const maxWait = opts.maxWait ?? 120;
  const checkInterval = opts.checkInterval ?? 10;
  const mailboxes = ["INBOX", "[Gmail]/Spam", "[Gmail]/Lixo eletrônico", "Junk"];
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait * 1000) {
    let client: InstanceType<typeof ImapFlow> | null = null;
    try {
      client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: loginEmail, pass: appPassword },
        logger: false as any,
      });
      await client.connect();

      for (const mailbox of mailboxes) {
        let lock;
        try {
          lock = await client.getMailboxLock(mailbox);
        } catch {
          continue;
        }
        try {
          // Buscas: por remetente e por assunto
          // Como queremos pegar e-mails antigos também (caso a conta já exista),
          // vamos buscar TODOS os e-mails do remetente, não apenas os não lidos.
          const queries: any[] = [];
          for (const f of opts.fromFilters) {
            queries.push({ from: f });
          }
          if (opts.subjectFilters) {
            for (const s of opts.subjectFilters) queries.push({ subject: s });
          }

          const sources: Buffer[] = [];
          for (const q of queries) {
            if (sources.length > 0) break;
            try {
              // Buscar os e-mails. O ImapFlow retorna na ordem de UID (mais antigos primeiro).
              // Vamos pegar todos e depois olhar os últimos (mais recentes).
              for await (const msg of client.fetch(q, { source: true })) {
                if (msg.source) sources.push(msg.source as Buffer);
              }
            } catch {
              // tenta próxima query
            }
          }

          // Pegar os 10 mais recentes e inverter para olhar do mais novo para o mais antigo
          const toCheck = sources.slice(-10).reverse();
          for (const src of toCheck) {
            const parsed = await simpleParser(src);
            const body = (parsed.html || parsed.textAsHtml || parsed.text || "") as string;
            const fullBody = extractEmailBody(body);
            for (const pattern of opts.patterns) {
              const m = fullBody.match(pattern);
              if (m) {
                try { lock.release(); } catch {}
                await client.logout();
                return m[1] !== undefined ? m[1] : m[0];
              }
            }
          }
        } finally {
          try { lock.release(); } catch {}
        }
      }

      await client.logout();
    } catch (e: any) {
      emit.log(`Erro IMAP (SEOFast): ${e.message?.slice(0, 80)}`, "warn");
      try { if (client) await client.logout(); } catch {}
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    emit.log(`Aguardando e-mail SEOFast... (${elapsed}s/${maxWait}s)`, "info");
    await sleep(checkInterval * 1000);
  }

  return null;
}

// ============================================================
// ETAPA 1 - REGISTRO DESKTOP (seo-fast.ru)
// ============================================================

interface RegisterResult {
  raw: string;
  password?: string;
  loginToken?: string;
  loginEmail?: string;
  emailInUse?: boolean;
}

async function seofastRegister(
  client: HttpClient,
  username: string,
  userEmail: string,
  emit: EmitFn,
  countryCode: string = "US"
): Promise<RegisterResult | null> {
  emit.log(`[SF 1/5] Registrando no SEO-Fast: ${username}`, "info");

  // Usar headers reais do navegador do usuário
  const regHeaders: Record<string, string> = {
    accept: "*/*",
    "accept-language": getBrowserLang(),
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: "https://seo-fast.ru",
    referer: "https://seo-fast.ru/register",
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": getBrowserUA(),
    "x-requested-with": "XMLHttpRequest",
  };
  emit.log(`[Headers] UA: ${getBrowserUA().slice(0, 60)}... | Lang: ${getBrowserLang().slice(0, 20)}`, "info");

  // Acessar página de registro para obter cookies/sessão
  await client.request("GET", `${SEOFAST_URL}/register`, {
    headers: {
      "user-agent": getBrowserUA(),
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": getBrowserLang(),
    },
  });
  await sleep(1000);

  const data = new URLSearchParams({
    sf: "register_r",
    regname: username,
    email: userEmail,
  }).toString();

  const resp = await client.request("POST", `${SEOFAST_URL}/ajax/ajax_register.php`, {
    headers: regHeaders,
    body: data,
  });

  const responseText = resp.text.trim();
  emit.log(`Resposta registro: ${responseText.slice(0, 120)}`, "info");

  const lower = responseText.toLowerCase();
  
  // Se o e-mail já estiver em uso, não falhamos completamente.
  // Vamos retornar uma flag para que o sistema tente buscar a senha no e-mail.
  if (lower.includes("уже") || lower.includes("already") || lower.includes("e-mail уже кем-то используется")) {
    emit.log(`E-mail já registrado no SEOFast. Tentando recuperar senha...`, "warn");
    return { raw: responseText, emailInUse: true };
  }
  
  if (lower.includes("заблокирован")) {
    emit.log(`Registro SEOFast falhou (bloqueado): ${responseText.slice(0, 100)}`, "error");
    return null;
  }

  const result: RegisterResult = { raw: responseText };

  const tokenMatch = responseText.match(/'sf'\s*:\s*'([A-F0-9]{32})'/);
  if (tokenMatch) result.loginToken = tokenMatch[1];

  const pwdMatch = responseText.match(/'logpassword'\s*:\s*'([a-zA-Z0-9]+)'/);
  if (pwdMatch) result.password = pwdMatch[1];

  const emailMatch = responseText.match(/'logusername'\s*:\s*'([^']+)'/);
  if (emailMatch) result.loginEmail = emailMatch[1];

  if (result.password) emit.log("Registro SEOFast OK (senha na resposta)!", "success");
  else emit.log("Registro SEOFast OK, senha será buscada no e-mail.", "info");

  return result;
}

// ============================================================
// ETAPA 2 - OBTER SENHA POR E-MAIL
// ============================================================

async function seofastGetPasswordFromEmail(
  config: Record<string, string>,
  emit: EmitFn
): Promise<string | null> {
  emit.log("[SF 2/5] Aguardando e-mail com senha do SEO-Fast...", "info");
  const patterns = [
    /(?:пароль|password|Пароль|Password)[:\s]*([a-zA-Z0-9]{6,20})/,
    /(?:pass|pwd)[:\s]*([a-zA-Z0-9]{6,20})/,
  ];
  const pwd = await waitForEmailMatch(config, emit, {
    fromFilters: ["seo-fast", "seo-fast.ru"],
    subjectFilters: ["seo-fast"],
    patterns,
    maxWait: 90,
    checkInterval: 8,
  });
  if (pwd) emit.log(`Senha SEOFast encontrada: ${pwd}`, "success");
  return pwd;
}

// ============================================================
// ETAPA 3 - LOGIN MOBILE (APK 1.1.1)
// ============================================================

interface MobileLoginResult {
  client: HttpClient;
  hashAjax: string;
  deviceId: string;
}

function extractHashAjax(html: string): string | null {
  let m = html.match(/hash_ajax\s*=\s*['"]([a-fA-F0-9]{32})['"]/);
  if (!m) m = html.match(/var\s+hash_ajax\s*=\s*['"]([a-fA-F0-9]+)['"]/);
  return m ? m[1] : null;
}

async function seofastMobileLogin(
  userEmail: string,
  password: string,
  emit: EmitFn,
  proxyAgent?: https.Agent
): Promise<MobileLoginResult | null> {
  emit.log("[SF 3/5] Login via API Mobile (seo-fast.bz) — Fluxo APK 1.1.1", "info");

  const deviceId = generateDeviceId();
  const appToken = generateAppToken(deviceId);
  const profile = getRandomProfile();
  const googleEmail = obfuscateEmail(userEmail);

  emit.log(`Device ID: ${deviceId} | Perfil: ${profile.hardware.model}`, "info");

  const client = new HttpClient({
    "User-Agent": getBrowserUA(),
    "X-App-Token": appToken,
    "X-App-Version": SEOFAST_APP_VERSION,
    "X-Device-Id": deviceId,
    "Accept-Language": getBrowserLang(),
  }, proxyAgent);

  // Etapa 2: GET ?pg=login
  let resp: HttpResponse;
  try {
    resp = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=login", { headers: mobilePageHeaders() });
  } catch (e: any) {
    emit.log(`Erro GET login: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }
  if (![200, 403].includes(resp.status)) {
    emit.log(`GET login HTTP ${resp.status}`, "error");
    return null;
  }

  const hashLogin = extractHashAjax(resp.text);
  if (!hashLogin) {
    emit.log("hash_ajax não encontrado na página de login", "error");
    return null;
  }
  emit.log(`hash_ajax (login): ${hashLogin}`, "info");

  await sleep(1000 + Math.random() * 1000);

  // Etapa 3: POST ajax_login.php
  const loginData = new URLSearchParams({
    login: userEmail,
    password,
    hash: hashLogin,
    ajax_func: "login",
  }).toString();

  let resp2: HttpResponse;
  try {
    resp2 = await client.request("POST", SEOFAST_MOBILE_URL + "ajax/ajax_login.php", {
      headers: mobileAjaxLoginHeaders(),
      body: loginData,
    });
  } catch (e: any) {
    emit.log(`POST login: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }
  if (![200, 403].includes(resp2.status)) {
    emit.log(`POST login HTTP ${resp2.status}`, "error");
    return null;
  }

  const loginResponse = resp2.text || "";
  if (loginResponse.includes("location.replace") && loginResponse.includes("pg=job")) {
    emit.log("Login aceito! (redirect para pg=job)", "success");
  } else if (loginResponse.includes("error_load") || loginResponse.toLowerCase().includes("ошибка")) {
    emit.log(`Login recusado: ${loginResponse.slice(0, 120)}`, "error");
    return null;
  } else if (loginResponse.includes("устарела")) {
    emit.log("Sessão expirada (hash antigo)", "error");
    return null;
  }

  await sleep(500 + Math.random() * 1000);

  // Etapa 4: GET ?pg=job
  let resp3: HttpResponse;
  try {
    resp3 = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=job", { headers: mobilePageHeaders() });
  } catch (e: any) {
    emit.log(`GET job: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }

  if (resp3.url.includes("pg=login") || (resp3.text || "").includes("login-card")) {
    emit.log("Redirecionado para login — sessão não autenticada", "error");
    return null;
  }

  const hashAjax = extractHashAjax(resp3.text);
  if (!hashAjax) {
    emit.log("hash_ajax não encontrado na página job", "error");
    return null;
  }
  emit.log(`hash_ajax (job): ${hashAjax}`, "info");

  if (resp3.text.includes("balanceUp") || resp3.text.includes("bm-balance")) {
    emit.log("Sessão confirmada (saldo visível)", "success");
  } else {
    emit.log("Sessão OK", "info");
  }

  // Etapa 5: POST ajax_data.php (up_data)
  const dataJson = generateDataJson(deviceId, profile, googleEmail);
  const screenResolution = `${profile.display.width_px}x${profile.display.height_px}`;
  const upDataPayload = {
    ajax_func: "up_data",
    hash_ajax: hashAjax,
    id_device: deviceId,
    email: googleEmail,
    os_version: profile.os.release,
    screen_resolution: screenResolution,
    locale_language: "pt",
    locale_country: "BR",
    data_json: dataJson,
  };

  try {
    const resp4 = await client.request("POST", SEOFAST_MOBILE_URL + "ajax/ajax_data.php", {
      headers: mobileAjaxJsonHeaders("https://seo-fast.bz/webapp/?pg=job"),
      body: JSON.stringify(upDataPayload),
    });
    if ([200, 403].includes(resp4.status)) {
      emit.log("Dispositivo registrado (up_data).", "success");
    } else {
      emit.log(`up_data HTTP ${resp4.status}, continuando...`, "warn");
    }
  } catch (e: any) {
    emit.log(`Erro up_data: ${e.message?.slice(0, 60)} (não crítico)`, "warn");
  }

  emit.log("Login SEOFast completo (fluxo APK 1.1.1).", "success");
  return { client, hashAjax, deviceId };
}

// ============================================================
// ETAPA 3.5 - LOGIN DESKTOP (seo-fast.ru) — SESSÃO SEPARADA
// ============================================================

/**
 * Extrai o token l_entrance da página de login do seo-fast.ru.
 * O site entrega esse token em vários formatos; tentamos uma cadeia de padrões.
 */
function extractEntranceToken(html: string): string | null {
  const patterns: RegExp[] = [
    /l_entrance\s*=\s*\$\.trim\(\s*['"]([a-fA-F0-9]{16,})['"]\s*\)/i,
    /l_entrance\s*=\s*['"]([a-fA-F0-9]{16,})['"]/i,
    /l_entrance\s*:\s*['"]([a-fA-F0-9]{16,})['"]/i,
    /name=['"]l_entrance['"][^>]*value=['"]([a-fA-F0-9]{16,})['"]/i,
    /value=['"]([a-fA-F0-9]{16,})['"][^>]*name=['"]l_entrance['"]/i,
    /name=['"]sf['"][^>]*value=['"]([a-fA-F0-9]{16,})['"]/i,
    /value=['"]([a-fA-F0-9]{16,})['"][^>]*name=['"]sf['"]/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }

  // Último recurso: capturar qualquer atribuição a l_entrance
  const loose = html.match(/l_entrance[\s\S]{0,40}?([a-fA-F0-9]{16,})/i);
  if (loose && loose[1]) return loose[1];

  return null;
}

/**
 * Login no domínio desktop (seo-fast.ru) usando um HttpClient separado.
 * Necessário porque seo-fast.bz e seo-fast.ru são domínios diferentes
 * com cookie jars separados. O ajax_profile.php só funciona com sessão .ru.
 *
 * Baseado no fluxo real capturado:
 *  1. GET /login → obtém l_entrance + cookie entrance
 *  2. POST /ajax/ajax_login.php com sf=l_entrance + logusername + logpassword
 *  3. Resposta "0" = sucesso
 */
async function loginDesktop(
  client: HttpClient,
  email: string,
  password: string,
  emit: EmitFn
): Promise<boolean> {
  emit.log(`[Desktop] Autenticando em seo-fast.ru...`, "info");

  // Step 1: GET login page para obter l_entrance e cookies (PHPSESSID, entrance)
  let resp: HttpResponse | null = null;
  let lEntrance: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      resp = await client.request("GET", `${SEOFAST_URL}/login`, {
        headers: desktopPageHeaders(SEOFAST_URL + "/"),
      });
    } catch (e: any) {
      emit.log(`Erro GET login desktop: ${e.message?.slice(0, 80)}`, "error");
      return false;
    }

    // Verificar se já está logado
    if (resp.text.includes("bm-balance") || resp.text.includes("balanceUp") || resp.text.includes("mystat")) {
      emit.log(`[Desktop] Já autenticado em seo-fast.ru`, "success");
      return true;
    }

    // Extrair l_entrance
    lEntrance = extractEntranceToken(resp.text);
    if (lEntrance) break;

    if (attempt < 2) {
      emit.log("[Desktop] Token não encontrado na 1ª tentativa, repetindo GET...", "warn");
      await sleep(1200 + Math.random() * 800);
    }
  }

  if (!resp) return false;

  // Extrair val_entrance (usado como cookie evercookie)
  let valEntrance: string | null = null;
  const valEntranceMatch =
    resp.text.match(/val_entrance\s*=\s*\$\.trim\(\s*['"]([a-fA-F0-9]{16,})['"]\s*\)/i) ||
    resp.text.match(/val_entrance\s*=\s*['"]([a-fA-F0-9]{16,})['"]/i);
  if (valEntranceMatch) {
    valEntrance = valEntranceMatch[1];
  }

  if (!lEntrance) {
    emit.log(`[Desktop] l_entrance não encontrado na página de login`, "error");
    const around = resp.text.match(/.{0,40}l_entrance.{0,80}/i);
    if (around) {
      emit.log(`[Desktop] Trecho: ${around[0].replace(/\s+/g, ' ').trim()}`, "info");
    }
    return false;
  }

  emit.log(`[Desktop] l_entrance: ${lEntrance.slice(0, 8)}...`, "info");

  // Setar cookie entrance (val_entrance)
  if (valEntrance) {
    client.setCookie("entrance", valEntrance, SEOFAST_URL);
  }

  await sleep(800 + Math.random() * 500);

  // Step 2: POST login com sf=l_entrance + logusername + logpassword
  // Usa apenas os parâmetros mínimos (como Firefox mobile - comprovado na captura)
  const loginData = new URLSearchParams({
    sf: lEntrance,
    logusername: email,
    logpassword: password,
  }).toString();

  const loginHeaders = desktopAjaxHeaders(`${SEOFAST_URL}/register`);

  let loginResp: HttpResponse;
  try {
    loginResp = await client.request("POST", `${SEOFAST_URL}/ajax/ajax_login.php`, {
      headers: loginHeaders,
      body: loginData,
    });
  } catch (e: any) {
    emit.log(`[Desktop] Erro POST login: ${e.message?.slice(0, 80)}`, "error");
    return false;
  }

  const loginRespText = loginResp.text?.trim() || "";
  emit.log(`[Desktop] Login resp: '${loginRespText.slice(0, 60)}'`, "info");

  // Resposta "0" = sucesso (redirect para mystat)
  if (loginRespText === "0") {
    emit.log(`[Desktop] Login aceito em seo-fast.ru (resp=0)`, "success");
    return true;
  }

  // Resposta é um hash hex de 32 chars = entrance_session (sucesso)
  if (loginRespText.length === 32 && /^[a-fA-F0-9]+$/.test(loginRespText)) {
    emit.log(`[Desktop] Login aceito com entrance_session`, "success");
    client.setCookie("entrance", loginRespText, SEOFAST_URL);
    return true;
  }

  if (loginRespText.includes("location.replace") || loginRespText.includes("location.href")) {
    emit.log(`[Desktop] Login aceito em seo-fast.ru (redirect)`, "success");
    return true;
  }

  if (loginRespText.includes("error_load") || loginRespText.toLowerCase().includes("ошибка") || loginRespText.includes("Неверный")) {
    emit.log(`[Desktop] Login recusado: ${loginRespText.slice(0, 150)}`, "error");
    return false;
  }

  if (loginRespText.includes("captcha") || loginRespText.includes("капча") || loginRespText.includes("Капча")) {
    emit.log(`[Desktop] Captcha requerido para login desktop`, "warn");
    return false;
  }

  // Tentar verificar acessando /profile
  await sleep(500);
  try {
    const checkResp = await client.request("GET", `${SEOFAST_URL}/profile`, {
      headers: desktopPageHeaders(`${SEOFAST_URL}/mystat`),
    });
    if (checkResp.text.includes("editprofile") || checkResp.text.includes("Кошельки") || checkResp.text.includes("purse")) {
      emit.log(`[Desktop] Login confirmado via /profile`, "success");
      return true;
    }
  } catch {
    // Ignora erros de verificação
  }

  emit.log(`[Desktop] Resposta login inesperada: ${loginRespText.slice(0, 100)}`, "warn");
  return false;
}

// ============================================================
// ETAPA 4 - VERIFICAÇÃO DE CARTEIRA (USANDO SESSÃO DESKTOP .ru)
// ============================================================

type VerifStatus = "verified" | "email_sent" | "already_requested" | "not_logged_in" | "error";

/**
 * Solicita verificação de carteira usando sessão desktop autenticada em seo-fast.ru.
 * 
 * CORREÇÃO: O endpoint ajax_profile.php requer sessão autenticada no domínio .ru.
 * O login mobile (seo-fast.bz) NÃO compartilha cookies com .ru.
 * Portanto, usamos um desktopClient separado que fez login em seo-fast.ru.
 */
async function seofastRequestVerification(
  desktopClient: HttpClient,
  emit: EmitFn
): Promise<VerifStatus> {
  emit.log("[SF 4/5] Solicitando verificação de carteira...", "info");

  // Navegar para /profile primeiro (simula comportamento do browser)
  try {
    await desktopClient.request("GET", `${SEOFAST_URL}/profile`, {
      headers: desktopPageHeaders(`${SEOFAST_URL}/mystat`),
    });
  } catch {
    // não crítico
  }
  await sleep(1000);

  // Headers para AJAX no domínio .ru (como na captura de tráfego que funciona)
  const headers = desktopAjaxHeaders(`${SEOFAST_URL}/profile`);

  const r = await desktopClient.request("POST", `${SEOFAST_URL}/ajax/ajax_profile.php`, {
    headers,
    body: new URLSearchParams({ sf: "verifik_test" }).toString(),
  });
  const responseText = r.text.trim();
  emit.log(`verifik_test: ${responseText.slice(0, 40)}`, "info");

  if (responseText === "2") {
    emit.log("Já verificado! Pode salvar carteira.", "success");
    return "verified";
  }

  if (responseText === "1") {
    emit.log("Enviando e-mail de verificação...", "info");
    const r2 = await desktopClient.request("POST", `${SEOFAST_URL}/ajax/ajax_profile.php`, {
      headers,
      body: new URLSearchParams({ sf: "verifik" }).toString(),
    });
    const resp = r2.text.trim();
    emit.log(`verifik: ${resp.slice(0, 40)}`, "info");
    if (resp === "1") {
      emit.log("E-mail de verificação enviado!", "success");
      return "email_sent";
    } else if (resp === "2") {
      emit.log("Verificação já solicitada anteriormente.", "warn");
      return "already_requested";
    }
    emit.log(`Erro verifik: ${resp.slice(0, 80)}`, "error");
    return "error";
  }

  if (responseText.includes("Войдите") || responseText.toLowerCase().includes("войдите")) {
    emit.log("Sessão expirada (não logado para profile)", "error");
    return "not_logged_in";
  }

  // Verificar se a resposta contém HTML (indica que não está logado - redirecionou para home)
  if (responseText.includes("<script") && responseText.includes("load_site")) {
    emit.log("Sessão expirada (resposta contém script de redirecionamento)", "error");
    return "not_logged_in";
  }

  emit.log(`Resposta verifik_test inesperada: ${responseText.slice(0, 80)}`, "warn");
  return "error";
}

async function seofastConfirmVerification(
  config: Record<string, string>,
  emit: EmitFn,
  proxyAgent?: https.Agent
): Promise<boolean> {
  emit.log("Aguardando e-mail de verificação SEOFast...", "info");
  const patterns = [
    /https?:\/\/seo-fast\.ru\/\?ver_pu_us=[a-f0-9]+/,
    /https?:\/\/seo-fast\.ru[^\s"'<>]*ver_pu_us[^\s"'<>]*/,
  ];

  const link = await waitForEmailMatch(config, emit, {
    fromFilters: ["seo-fast"],
    subjectFilters: ["seo-fast", "верификац", "verif"],
    patterns,
    maxWait: 120,
    checkInterval: 10,
  });

  if (!link) {
    emit.log("Link de verificação SEOFast não chegou.", "error");
    return false;
  }

  const cleanLink = link.replace(/&amp;/g, "&");
  emit.log(`Link de verificação: ${cleanLink.slice(0, 60)}...`, "info");

  try {
    const verifyClient = new HttpClient({
      "user-agent": getBrowserUA(),
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }, proxyAgent);
    const r = await verifyClient.request("GET", cleanLink, {});
    emit.log(`Verificação acessada (HTTP ${r.status}).`, r.status === 200 ? "success" : "warn");
    return true;
  } catch (e: any) {
    emit.log(`Erro ao acessar link de verificação: ${e.message?.slice(0, 60)}`, "error");
    return false;
  }
}

// ============================================================
// ETAPA 5 - SALVAR CARTEIRA FAUCETPAY (USANDO SESSÃO DESKTOP .ru)
// ============================================================

/**
 * Salva a carteira FaucetPay usando sessão desktop autenticada em seo-fast.ru.
 * 
 * CORREÇÃO: Usa o desktopClient (sessão .ru) em vez do client mobile (.bz).
 */
async function seofastSaveWallet(
  desktopClient: HttpClient,
  faucetpayEmail: string,
  emit: EmitFn
): Promise<boolean> {
  emit.log(`[SF 5/5] Salvando carteira FaucetPay: ${faucetpayEmail}`, "info");

  // Navegar para /profile primeiro
  await desktopClient.request("GET", `${SEOFAST_URL}/profile`, {
    headers: desktopPageHeaders(`${SEOFAST_URL}/mystat`),
  });
  await sleep(1000);

  const headers = desktopAjaxHeaders(`${SEOFAST_URL}/profile`);

  // Verificar se está verificado
  const test = await desktopClient.request("POST", `${SEOFAST_URL}/ajax/ajax_profile.php`, {
    headers,
    body: new URLSearchParams({ sf: "verifik_test" }).toString(),
  });
  if (test.text.trim() !== "2") {
    emit.log(`Ainda não verificado (verifik_test=${test.text.trim()})`, "error");
    return false;
  }

  // Salvar carteira
  const data = new URLSearchParams({
    sf: "purse_add",
    sys: "faucetpay",
    purse_us: faucetpayEmail,
    mobile_o: "",
  }).toString();

  const r = await desktopClient.request("POST", `${SEOFAST_URL}/ajax/ajax_profile.php`, {
    headers,
    body: data,
  });
  const responseText = r.text.trim();
  emit.log(`Resposta purse_add: ${responseText.slice(0, 40)}`, "info");

  if (responseText === "1000") {
    emit.log("Carteira FaucetPay salva com sucesso!", "success");
    return true;
  } else if (responseText === "2") {
    emit.log("Carteira já existe na base.", "warn");
    return true;
  } else if (responseText === "11" || responseText === "111") {
    emit.log("Precisa verificação primeiro.", "error");
    return false;
  }

  const errorMessages: Record<string, string> = {
    "1": "Carteira indicada incorretamente",
    "4": "Alterações de pagamento desativadas",
    "6": "Carteira bloqueada anteriormente",
    "10": "Adição de carteiras proibida",
  };
  emit.log(errorMessages[responseText] || `Erro desconhecido: ${responseText}`, "error");
  return false;
}

// ============================================================
// FLUXO PRINCIPAL SEOFast
// ============================================================

export interface SeofastResult {
  success: boolean;
  username?: string;
  password?: string;
  message: string;
}

/**
 * Cria a conta no SEOFast e salva a carteira FaucetPay.
 * @param userEmail        e-mail usado no FaucetPay (também usado no SEOFast)
 * @param faucetpayEmail   e-mail da carteira FaucetPay a salvar (mesmo e-mail)
 * @param seofastUsername  nick opcional; se ausente, gera automaticamente
 */
export async function createSeofastAccount(
  config: Record<string, string>,
  userEmail: string,
  faucetpayEmail: string,
  seofastUsername: string | undefined,
  emit: EmitFn,
  browserHeaders?: BrowserHeaders
): Promise<SeofastResult> {
  // Setar headers do navegador real para uso em todas as requisições deste ciclo
  _seofastBrowserHeaders = browserHeaders;
  if (browserHeaders) {
    emit.log(`[SEOFast Headers] UA: ${browserHeaders["user-agent"]?.slice(0, 60)}... | Lang: ${browserHeaders["accept-language"]?.slice(0, 20)}`, "info");
  }
  // Proxy DataImpulse com IP fixo (sessid) ancorado no e-mail da conta —
  // mantém o MESMO IP usado no fluxo FaucetPay.
  const proxyCfg = resolveProxyConfig(config);
  const proxyAgent = createProxyHttpsAgent(proxyCfg, userEmail, {
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
    // @ts-ignore - 'ciphers' aceito pelo TLS connect options
    ciphers: "DEFAULT@SECLEVEL=1",
  });
  emit.log(`Proxy SEOFast: ${proxyLabel(proxyCfg, userEmail)}`, "info");

  const registrationClient = new HttpClient({}, proxyAgent);

  let username = seofastUsername;
  if (!username) {
    const base = userEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    // SEOFast exige entre 5 e 13 caracteres
    // Vamos pegar até 10 caracteres do base e adicionar 3 números
    const safeBase = base.substring(0, 10);
    username = safeBase + String(Math.floor(100 + Math.random() * 900));
    
    // Garantir mínimo de 5 caracteres
    if (username.length < 5) {
      username = username + "12345".substring(0, 5 - username.length);
    }
  }

  emit.log(`Nick SEO-Fast: ${username} | Carteira: ${faucetpayEmail}`, "info");

  // 1. Registro desktop
  const regResult = await seofastRegister(registrationClient, username, userEmail, emit);
  if (!regResult) {
    return { success: false, message: "Falha no registro SEOFast." };
  }

  // 2. Obter senha
  let seofastPassword = regResult.password;
  
  // Se o e-mail já estiver em uso, não temos a senha na resposta do registro.
  // Precisamos buscar no e-mail.
  if (!seofastPassword || regResult.emailInUse) {
    if (regResult.emailInUse) {
      emit.log("Buscando senha de conta já existente no e-mail...", "info");
    }
    await sleep(5000);
    seofastPassword = (await seofastGetPasswordFromEmail(config, emit)) || undefined;
  }
  
  if (!seofastPassword) {
    return { success: false, username, message: "Não foi possível obter a senha do SEOFast." };
  }
  emit.log(`Senha SEOFast: ${seofastPassword}`, "info");

  // 3. Login mobile (seo-fast.bz/webapp/)
  await sleep(2000);
  const login = await seofastMobileLogin(userEmail, seofastPassword, emit, proxyAgent);
  if (!login) {
    return {
      success: false,
      username,
      password: seofastPassword,
      message: "Falha no login mobile SEOFast.",
    };
  }

  // 3.5. Login desktop (seo-fast.ru) — sessão separada para ajax_profile.php
  // CORREÇÃO: seo-fast.bz e seo-fast.ru são domínios diferentes com cookie jars
  // separados. O ajax_profile.php (verifik_test, verifik, purse_add) só funciona
  // com sessão autenticada em seo-fast.ru.
  await sleep(1500);
  const desktopClient = new HttpClient({}, proxyAgent);
  const desktopLoggedIn = await loginDesktop(desktopClient, userEmail, seofastPassword, emit);
  if (!desktopLoggedIn) {
    emit.log("Falha no login desktop, tentando usar token do registro...", "warn");
    // Fallback: tentar usar o registrationClient que já tem cookies do registro
    // (pode funcionar se a sessão do registro ainda estiver ativa)
    const fallbackResp = await registrationClient.request("POST", `${SEOFAST_URL}/ajax/ajax_profile.php`, {
      headers: desktopAjaxHeaders(`${SEOFAST_URL}/profile`),
      body: new URLSearchParams({ sf: "verifik_test" }).toString(),
    });
    if (fallbackResp.text.trim() === "1" || fallbackResp.text.trim() === "2") {
      emit.log("[Desktop] Sessão do registro ainda ativa, usando-a.", "success");
      // Usar registrationClient como desktopClient
      const verifStatus = await seofastRequestVerification(registrationClient, emit);
      if (verifStatus === "email_sent" || verifStatus === "already_requested") {
        await sleep(5000);
        await seofastConfirmVerification(config, emit, proxyAgent);
      }
      // Vinculação wallet DESATIVADA - usuário vincula manualmente
      emit.log("[SF 5/5] Vinculação FaucetPay desativada (vincular manualmente).", "info");
      return {
        success: true,
        username,
        password: seofastPassword,
        message: "Conta SEOFast criada com sucesso! Vincule a carteira FaucetPay manualmente.",
      };
    }
    return {
      success: false,
      username,
      password: seofastPassword,
      message: "Falha no login desktop SEOFast.",
    };
  }

  // 4. Verificação (usando sessão desktop .ru)
  const verifStatus = await seofastRequestVerification(desktopClient, emit);
  if (verifStatus === "email_sent" || verifStatus === "already_requested") {
    await sleep(5000);
    const confirmed = await seofastConfirmVerification(config, emit, proxyAgent);
    if (!confirmed) {
      return {
        success: false,
        username,
        password: seofastPassword,
        message: "Verificação SEOFast não confirmada.",
      };
    }
  } else if (verifStatus === "not_logged_in" || verifStatus === "error") {
    return {
      success: false,
      username,
      password: seofastPassword,
      message: "Erro na verificação SEOFast.",
    };
  }

  // 5. Vinculação de carteira FaucetPay DESATIVADA
  // O usuário vincula manualmente no SEOFast.
  emit.log("[SF 5/5] Vinculação FaucetPay desativada (vincular manualmente).", "info");

  return {
    success: true,
    username,
    password: seofastPassword,
    message: "Conta SEOFast criada com sucesso! Vincule a carteira FaucetPay manualmente.",
  };

  /* DESATIVADO - Salvar carteira automático
  await sleep(2000);
  const walletSaved = await seofastSaveWallet(desktopClient, faucetpayEmail, emit);

  if (walletSaved) {
    return {
      success: true,
      username,
      password: seofastPassword,
      message: "Conta SEOFast criada e carteira FaucetPay configurada!",
    };
  }

  return {
    success: false,
    username,
    password: seofastPassword,
    message: "Conta SEOFast criada, mas carteira não foi salva.",
  };
  */
}

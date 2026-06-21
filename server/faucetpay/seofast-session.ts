/**
 * SEOFast Session Manager
 * 
 * Gerencia sessões persistentes de contas SEOFast.
 * Login é feito uma vez e a sessão fica disponível para:
 * - Verificar saldo
 * - Verificar disponibilidade de saque
 * - Executar saque
 * - Outras funções futuras
 * 
 * Baseado no fluxo do script Python seofast_bot_v3supremo.py
 */

import crypto from "crypto";
import https from "https";
import zlib from "zlib";
import { URLSearchParams } from "url";
import type { EmitFn, BrowserHeaders } from "./engine";
import { invokeLLM } from "../_core/llm";
import { resolveProxyConfig, createProxyHttpsAgent, proxyLabel } from "./proxy";
import { getDb } from "../db";
import { accounts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ============================================================
// BROWSER HEADERS - Capturados do navegador real do usuário
// ============================================================

/** Variável de módulo que armazena os browserHeaders ativos */
let _sessionBrowserHeaders: BrowserHeaders | undefined = undefined;

const FALLBACK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const FALLBACK_LANG = "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7";
const FALLBACK_CH_UA = '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"';
const FALLBACK_CH_MOBILE = "?0";
const FALLBACK_CH_PLATFORM = '"Windows"';

function getBrowserUA(): string {
  return _sessionBrowserHeaders?.["user-agent"] || FALLBACK_UA;
}
function getBrowserLang(): string {
  return _sessionBrowserHeaders?.["accept-language"] || FALLBACK_LANG;
}
function getBrowserChUa(): string {
  return _sessionBrowserHeaders?.["sec-ch-ua"] || FALLBACK_CH_UA;
}
function getBrowserChMobile(): string {
  return _sessionBrowserHeaders?.["sec-ch-ua-mobile"] || FALLBACK_CH_MOBILE;
}
function getBrowserChPlatform(): string {
  return _sessionBrowserHeaders?.["sec-ch-ua-platform"] || FALLBACK_CH_PLATFORM;
}

// ============================================================
// CONFIG
// ============================================================

const SEOFAST_MOBILE_URL = "https://seo-fast.bz/webapp/";
const SEOFAST_DESKTOP_URL = "https://seo-fast.ru";
const SEOFAST_APP_VERSION = "1.1.1";
const SEOFAST_APP_SECRET = "seo_fast_SFk1gR5h5DGH";
const SEOFAST_PACKAGE_NAME = "com.example.seofast";

// Session TTL: 25 minutes (sessions expire after inactivity)
const SESSION_TTL_MS = 25 * 60 * 1000;

// ============================================================
// DEVICE PROFILES
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
    hardware: { brand: "google", model: "Pixel 8 Pro", device: "husky", hardware: "zuma", manufacturer: "Google", product: "husky", board: "zuma" },
    os: { sdk_int: 34, release: "14", incremental: "AP2A.240805.005" },
    display: { width_px: 1344, height_px: 2992, density_dpi: 560, density: 3.5 },
    fingerprint: "google/husky/husky:14/AP2A.240805.005/12025142:user/release-keys",
    build_id: "AP2A.240805.005",
    host: "abfarm",
  },
  {
    hardware: { brand: "xiaomi", model: "23127PN0CG", device: "shennong", hardware: "qcom", manufacturer: "Xiaomi", product: "shennong", board: "pineapple" },
    os: { sdk_int: 34, release: "14", incremental: "OS1.0.14.0.UNCCNXM" },
    display: { width_px: 1440, height_px: 3200, density_dpi: 640, density: 4.0 },
    fingerprint: "Xiaomi/shennong/shennong:14/UKQ1.231003.002/OS1.0.14.0.UNCCNXM:user/release-keys",
    build_id: "UKQ1.231003.002",
    host: "pangu-build-component-system",
  },
];

// ============================================================
// HELPERS
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// ============================================================
// HTTP CLIENT (TLS 1.2 + Cookie Jar)
// ============================================================

const tlsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  // @ts-ignore
  ciphers: "DEFAULT@SECLEVEL=1",
});

interface HttpResponse {
  status: number;
  text: string;
  url: string;
}

class HttpClient {
  private cookies: Map<string, string> = new Map();
  private baseHeaders: Record<string, string>;
  private agent: https.Agent = tlsAgent;

  constructor(baseHeaders: Record<string, string> = {}, agent?: https.Agent) {
    this.baseHeaders = baseHeaders;
    if (agent) this.agent = agent;
  }

  getCookieValue(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
  }

  exportCookies(): string {
    return JSON.stringify(Array.from(this.cookies.entries()));
  }

  importCookies(json: string) {
    try {
      const entries = JSON.parse(json);
      if (Array.isArray(entries)) {
        this.cookies = new Map(entries);
      }
    } catch (e) {
      // ignore
    }
  }

  private getCookieHeader(): string {
    const parts: string[] = [];
    this.cookies.forEach((v, k) => {
      parts.push(`${k}=${v}`);
    });
    return parts.join("; ");
  }

  private parseCookies(setCookieHeaders: string[]) {
    for (const sc of setCookieHeaders) {
      const parts = sc.split(";")[0];
      const eqIdx = parts.indexOf("=");
      if (eqIdx > 0) {
        const name = parts.substring(0, eqIdx).trim();
        const value = parts.substring(eqIdx + 1).trim();
        this.cookies.set(name, value);
      }
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
    return new Promise((resolve, reject) => {
      if (redirectCount > 8) {
        reject(new Error("Too many redirects"));
        return;
      }

      const cookieHeader = this.getCookieHeader();
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
          const setCookies = res.headers["set-cookie"] || [];
          this.parseCookies(setCookies);

          if (
            followRedirects &&
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const nextUrl = new URL(res.headers.location, url).toString();
            res.resume();
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
              // Fallback to raw buffer if decompression fails
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
// HEADERS
// ============================================================

function mobilePageHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "Upgrade-Insecure-Requests": "1",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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
    Accept: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01",
    Origin: "https://seo-fast.bz",
    Referer: "https://seo-fast.bz/webapp/?pg=login",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
}

function desktopAjaxHeaders(): Record<string, string> {
  return {
    accept: "*/*",
    "accept-language": getBrowserLang(),
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: "https://seo-fast.ru",
    "sec-ch-ua": getBrowserChUa(),
    "sec-ch-ua-mobile": getBrowserChMobile(),
    "sec-ch-ua-platform": getBrowserChPlatform(),
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": getBrowserUA(),
    "x-requested-with": "XMLHttpRequest",
  };
}

/**
 * Headers para navegação de página HTML (GET de páginas como /mystat, /payment_user)
 * Usa Firefox/Android (consistente com o login que funciona)
 * NÃO usa XMLHttpRequest - simula navegação real do browser
 */
function desktopPageHeaders(referer?: string): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": getBrowserLang(),
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": getBrowserUA(),
    ...(referer ? { referer } : {}),
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
// HELPER FUNCTIONS
// ============================================================

function extractHashAjax(html: string): string | null {
  // Try HashAjax (uppercase) first - this is the main pattern in /mystat
  let m = html.match(/HashAjax\s*=\s*['"]([a-fA-F0-9]{32})['"]/);
  if (!m) m = html.match(/hash_ajax\s*=\s*['"]([a-fA-F0-9]{32})['"]/);
  if (!m) m = html.match(/var\s+hash_ajax\s*=\s*['"]([a-fA-F0-9]+)['"]/);
  if (!m) m = html.match(/var\s+HashAjax\s*=\s*['"]([a-fA-F0-9]+)['"]/);
  return m ? m[1] : null;
}

function extractBalance(html: string): string | null {
  let m = html.match(/bm-balance[^>]*>([^<]+)</);
  if (!m) m = html.match(/balanceUp[^>]*>([^<]+)</);
  if (!m) m = html.match(/Основной счёт[^<]*<[^>]*>([0-9.,]+)/);
  if (!m) m = html.match(/balance[^>]*>(\d+[.,]\d+)/);
  return m ? m[1].trim() : null;
}

function extractPaymentHash(html: string): string | null {
  let m = html.match(/'hash'\s*:\s*'([a-fA-F0-9]{32})'/);
  if (!m) m = html.match(/"hash"\s*:\s*"([a-fA-F0-9]{32})"/);
  if (!m) m = html.match(/hash\s*=\s*['"]([a-fA-F0-9]{32})['"]/);
  if (!m) m = html.match(/hash=([a-fA-F0-9]{32})/);
  return m ? m[1] : null;
}

// ============================================================
// SESSION STORE (in-memory)
// ============================================================

export interface SeofastSession {
  email: string;
  client: HttpClient;
  desktopClient: HttpClient; // Separate client for seo-fast.ru (different cookie jar)
  hashAjax: string;
  deviceId: string;
  profile: DeviceProfile;
  balance: string;
  loginTime: number;
  lastActivity: number;
  connected: boolean;
}

export type SessionStatus = "connected" | "disconnected" | "connecting" | "error";

export interface SessionInfo {
  email: string;
  status: SessionStatus;
  balance: string;
  loginTime: number;
  lastActivity: number;
  withdrawalStatus?: WithdrawalAvailability;
  message?: string;
}

export type WithdrawalAvailability = "available" | "requires_approval" | "pending" | "no_wallet" | "unknown";

// Global session store
const sessions: Map<string, SeofastSession> = new Map();

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Get current session info for an account
 */
export function getSessionInfo(email: string): SessionInfo | null {
  const session = sessions.get(email);
  if (!session) return null;

  // Check if session expired
  if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
    sessions.delete(email);
    return null;
  }

  return {
    email: session.email,
    status: session.connected ? "connected" : "disconnected",
    balance: session.balance,
    loginTime: session.loginTime,
    lastActivity: session.lastActivity,
  };
}

/**
 * Get all active sessions
 */
export function getAllSessions(): SessionInfo[] {
  const result: SessionInfo[] = [];
  const now = Date.now();

  sessions.forEach((session, email) => {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(email);
    } else {
      result.push({
        email,
        status: session.connected ? "connected" : "disconnected",
        balance: session.balance,
        loginTime: session.loginTime,
        lastActivity: session.lastActivity,
      });
    }
  });

  return result;
}

/**
 * Disconnect a session
 */
export function disconnectSession(email: string): void {
  sessions.delete(email);
}

/**
 * Disconnect all sessions
 */
export function disconnectAllSessions(): void {
  sessions.clear();
}

// ============================================================
// LOGIN (creates persistent session)
// ============================================================

/**
 * Login to SEOFast and create a persistent session.
 * If session already exists and is valid, returns it without re-logging.
 */
export async function loginSession(
  email: string,
  password: string,
  emit: EmitFn,
  proxyAgent?: https.Agent,
  browserHeaders?: BrowserHeaders
): Promise<SessionInfo> {
  // Setar headers do navegador real para uso em todas as requisições deste ciclo
  if (browserHeaders) _sessionBrowserHeaders = browserHeaders;
  // Check existing session in memory
  const existing = sessions.get(email);
  if (existing && Date.now() - existing.lastActivity < SESSION_TTL_MS) {
    existing.lastActivity = Date.now();
    emit.log(`Sessão ativa reutilizada para ${email}`, "success");
    return {
      email: existing.email,
      status: "connected",
      balance: existing.balance,
      loginTime: existing.loginTime,
      lastActivity: existing.lastActivity,
    };
  }

  emit.log(`[Login] Conectando à conta ${email}...`, "info");

  let deviceId = generateDeviceId();
  let profile = getRandomProfile();
  let savedCookies: string | null = null;
  let savedHashAjax: string | null = null;

  // Try to load session from database
  const db = await getDb();
  if (db) {
    const accountRecord = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
    if (accountRecord.length > 0) {
      const acc = accountRecord[0];
      if (acc.seofastCookies && acc.seofastDeviceId && acc.seofastProfile) {
        emit.log("Sessão encontrada no banco de dados, tentando restaurar...", "info");
        deviceId = acc.seofastDeviceId;
        try {
          profile = JSON.parse(acc.seofastProfile);
        } catch (e) {}
        savedCookies = acc.seofastCookies;
        savedHashAjax = acc.seofastHashAjax;
      }
    }
  }

  const appToken = generateAppToken(deviceId);
  emit.log(`Device: ${profile.hardware.model} | ID: ${deviceId.slice(0, 12)}...`, "info");

  const client = new HttpClient({
    "User-Agent": getBrowserUA(),
    "X-App-Token": appToken,
    "X-App-Version": SEOFAST_APP_VERSION,
    "X-Device-Id": deviceId,
    "Accept-Language": getBrowserLang(),
  }, proxyAgent);

  if (savedCookies) {
    client.importCookies(savedCookies);
  }

  let needsLogin = true;

  if (savedCookies) {
    // Test if session is still valid by accessing job page
    try {
      const testResp = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=job", { headers: mobilePageHeaders() });
      if (!testResp.url.includes("pg=login") && !testResp.text.includes("login-card")) {
        emit.log("Sessão restaurada com sucesso!", "success");
        needsLogin = false;
      } else {
        emit.log("Sessão salva expirou, fazendo novo login...", "warn");
      }
    } catch (e) {
      emit.log("Erro ao testar sessão salva, fazendo novo login...", "warn");
    }
  }

  if (needsLogin) {
    // GET login page
    let resp: HttpResponse;
    try {
      resp = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=login", { headers: mobilePageHeaders() });
    } catch (e: any) {
      emit.log(`Erro GET login: ${e.message?.slice(0, 80)}`, "error");
      return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "Erro ao acessar página de login" };
    }

    const hashLogin = extractHashAjax(resp.text);
    if (!hashLogin) {
      emit.log("hash_ajax não encontrado na página de login", "error");
      return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "hash_ajax não encontrado" };
    }

    await sleep(1000 + Math.random() * 1000);

    // POST login
    const loginData = new URLSearchParams({
      login: email,
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
      return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "Erro no POST login" };
    }

    const loginResponse = resp2.text || "";
    if (loginResponse.includes("location.replace") && loginResponse.includes("pg=job")) {
      emit.log("Login aceito!", "success");
    } else if (loginResponse.includes("error_load") || loginResponse.toLowerCase().includes("ошибка")) {
      emit.log(`Login recusado: ${loginResponse.slice(0, 120)}`, "error");
      return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "Credenciais inválidas" };
    } else if (loginResponse.includes("устарела")) {
      emit.log("Sessão expirada (hash antigo)", "error");
      return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "Sessão expirada" };
    }

    await sleep(500 + Math.random() * 1000);
  }

  // GET job page to get hash_ajax and balance
  let resp3: HttpResponse;
  try {
    resp3 = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=job", { headers: mobilePageHeaders() });
  } catch (e: any) {
    emit.log(`GET job: ${e.message?.slice(0, 80)}`, "error");
    return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "Erro ao acessar página job" };
  }

  if (resp3.url.includes("pg=login") || resp3.text.includes("login-card")) {
    emit.log("Sessão não autenticada", "error");
    return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "Sessão não autenticada" };
  }

  const hashAjax = extractHashAjax(resp3.text);
  if (!hashAjax) {
    emit.log("hash_ajax não encontrado na página job", "error");
    return { email, status: "error", balance: "0", loginTime: 0, lastActivity: 0, message: "hash_ajax não encontrado (job)" };
  }

  // Extract balance from job page
  const balance = extractBalance(resp3.text) || "0.00";
  emit.log(`Sessão ativa | Saldo: ${balance} руб. | hash: ${hashAjax.slice(0, 8)}...`, "success");

  // Store session
  const now = Date.now();
  const desktopClient = new HttpClient({}, proxyAgent); // Separate cookie jar for seo-fast.ru
  const session: SeofastSession = {
    email,
    client,
    desktopClient,
    hashAjax,
    deviceId,
    profile,
    balance,
    loginTime: now,
    lastActivity: now,
    connected: true,
  };
  sessions.set(email, session);

  // Save session to database
  if (db) {
    try {
      await db.update(accounts).set({
        seofastCookies: client.exportCookies(),
        seofastDeviceId: deviceId,
        seofastProfile: JSON.stringify(profile),
        seofastHashAjax: hashAjax,
      }).where(eq(accounts.email, email));
    } catch (e) {
      emit.log("Erro ao salvar sessão no banco de dados", "warn");
    }
  }

  return {
    email,
    status: "connected",
    balance,
    loginTime: now,
    lastActivity: now,
  };
}

// ============================================================
// FETCH BALANCE (uses existing session)
// ============================================================

/**
 * Refresh the balance for an existing session
 */
export async function refreshBalance(
  email: string,
  emit: EmitFn
): Promise<{ balance: string; success: boolean }> {
  const session = sessions.get(email);
  if (!session || Date.now() - session.lastActivity > SESSION_TTL_MS) {
    emit.log(`Sessão expirada ou inexistente para ${email}`, "error");
    sessions.delete(email);
    return { balance: "0", success: false };
  }

  try {
    const resp = await session.client.request("GET", SEOFAST_MOBILE_URL + "?pg=job", { headers: mobilePageHeaders() });
    if (resp.text.includes("login-card") || resp.url.includes("pg=login")) {
      emit.log("Sessão expirada no servidor", "error");
      sessions.delete(email);
      return { balance: "0", success: false };
    }

    const balance = extractBalance(resp.text) || session.balance;
    session.balance = balance;
    session.lastActivity = Date.now();
    emit.log(`Saldo atualizado: ${balance} руб.`, "info");
    return { balance, success: true };
  } catch (e: any) {
    emit.log(`Erro ao atualizar saldo: ${e.message?.slice(0, 60)}`, "error");
    return { balance: session.balance, success: false };
  }
}

// ============================================================
// DESKTOP LOGIN (for payment_user access on seo-fast.ru)
// ============================================================

/**
 * Login on the desktop domain (seo-fast.ru) using the same credentials.
 * This is needed because seo-fast.bz and seo-fast.ru are different domains
 * with separate cookie jars. The payment_user page only works on .ru.
 */
/**
 * Extrai o token l_entrance (usado como parâmetro `sf` no login do seo-fast.ru)
 * de forma robusta. O site já entregou esse token em vários formatos, então
 * tentamos uma cadeia de padrões do mais específico ao mais genérico.
 */
export function extractEntranceToken(html: string): string | null {
  const patterns: RegExp[] = [
    // var l_entrance = $.trim('HASH');  (formato clássico)
    /l_entrance\s*=\s*\$\.trim\(\s*['"]([a-fA-F0-9]{16,})['"]\s*\)/i,
    // l_entrance = 'HASH';  ou  l_entrance="HASH";
    /l_entrance\s*=\s*['"]([a-fA-F0-9]{16,})['"]/i,
    // l_entrance : 'HASH'  (objeto)
    /l_entrance\s*:\s*['"]([a-fA-F0-9]{16,})['"]/i,
    // <input name="l_entrance" value="HASH">  (qualquer ordem de atributos)
    /name=['"]l_entrance['"][^>]*value=['"]([a-fA-F0-9]{16,})['"]/i,
    /value=['"]([a-fA-F0-9]{16,})['"][^>]*name=['"]l_entrance['"]/i,
    // <input name="sf" value="HASH">  (o campo enviado é sf=l_entrance)
    /name=['"]sf['"][^>]*value=['"]([a-fA-F0-9]{16,})['"]/i,
    /value=['"]([a-fA-F0-9]{16,})['"][^>]*name=['"]sf['"]/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }

  // Último recurso: capturar qualquer atribuição a l_entrance e extrair um
  // hash hexadecimal longo de dentro dela (cobre aspas/concatenações exóticas).
  const loose = html.match(/l_entrance[\s\S]{0,40}?([a-fA-F0-9]{16,})/i);
  if (loose && loose[1]) return loose[1];

  return null;
}

async function loginDesktop(
  client: HttpClient,
  email: string,
  password: string,
  emit: EmitFn
): Promise<boolean> {
  emit.log(`[Desktop] Autenticando em seo-fast.ru...`, "info");

  // Step 1: GET login page to get l_entrance and val_entrance.
  // Às vezes a primeira visita retorna uma página de verificação de dispositivo
  // (JS de window.devicePixelRatio) em vez da página de login com o token.
  // Por isso fazemos até 2 tentativas, reaproveitando os cookies recebidos.
  let resp: HttpResponse | null = null;
  let lEntrance: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      resp = await client.request("GET", SEOFAST_DESKTOP_URL + "/login", {
        headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/"),
      });
    } catch (e: any) {
      emit.log(`Erro GET login desktop: ${e.message?.slice(0, 80)}`, "error");
      return false;
    }

    // Check if already logged in (has balance or profile elements)
    if (resp.text.includes("bm-balance") || resp.text.includes("balanceUp") || resp.text.includes("mystat")) {
      emit.log(`[Desktop] Já autenticado em seo-fast.ru`, "success");
      return true;
    }

    // Extract l_entrance (the sf parameter for login). Formatos variados:
    //   var l_entrance = $.trim('FE68...25');  |  l_entrance = "fe68...";
    //   <input name="sf" value="fe68...">  (cadeia de padrões robusta)
    lEntrance = extractEntranceToken(resp.text);
    if (lEntrance) break;

    if (attempt < 2) {
      emit.log("[Desktop] Token não encontrado na 1ª tentativa, repetindo GET...", "warn");
      await sleep(1200 + Math.random() * 800);
    }
  }

  if (!resp) return false;

  // Extract val_entrance (used as cookie/evercookie). Aceita hex de 16+ chars.
  let valEntrance: string | null = null;
  const valEntranceMatch =
    resp.text.match(/val_entrance\s*=\s*\$\.trim\(\s*['"]([a-fA-F0-9]{16,})['"]\s*\)/i) ||
    resp.text.match(/val_entrance\s*=\s*['"]([a-fA-F0-9]{16,})['"]/i);
  if (valEntranceMatch) {
    valEntrance = valEntranceMatch[1];
  }

  if (!lEntrance) {
    emit.log(`l_entrance não encontrado na página de login`, "error");
    // Debug: mostra trechos contendo 'entrance' para diagnóstico do formato.
    const around = resp.text.match(/.{0,40}l_entrance.{0,80}/i);
    if (around) {
      emit.log(`Trecho l_entrance: ${around[0].replace(/\s+/g, ' ').trim()}`, "info");
    } else {
      const textContent = resp.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
      emit.log(`Conteúdo: ${textContent}`, "info");
    }
    return false;
  }

  emit.log(`[Desktop] l_entrance: ${lEntrance.slice(0, 8)}...`, "info");

  // Set the entrance cookie (val_entrance)
  if (valEntrance) {
    client.setCookie("entrance", valEntrance);
  }

  return await doDesktopLogin(client, email, password, lEntrance, valEntrance, emit);
}

async function doDesktopLogin(
  client: HttpClient,
  email: string,
  password: string,
  lEntrance: string,
  valEntrance: string | null,
  emit: EmitFn
): Promise<boolean> {
  await sleep(800 + Math.random() * 500);

  // Use minimal login params (like mobile Firefox - proven to work)
  // Only sf + logusername + logpassword - no extra fingerprint data
  const loginData = new URLSearchParams({
    sf: lEntrance,
    logusername: email,
    logpassword: password,
  }).toString();

  // Usa headers reais do navegador do usuário
  const loginHeaders: Record<string, string> = {
    accept: "*/*",
    "accept-language": getBrowserLang(),
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
    origin: "https://seo-fast.ru",
    referer: SEOFAST_DESKTOP_URL + "/login",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": getBrowserUA(),
  };

  let resp: HttpResponse;
  try {
    resp = await client.request("POST", SEOFAST_DESKTOP_URL + "/ajax/ajax_login.php", {
      headers: loginHeaders,
      body: loginData,
    });
  } catch (e: any) {
    emit.log(`Erro POST login desktop: ${e.message?.slice(0, 80)}`, "error");
    return false;
  }

  const loginResp = resp.text?.trim() || "";

  // Debug: log cookies after login POST
  const phpSessId = client.getCookieValue("PHPSESSID");
  const entranceCookie = client.getCookieValue("entrance");
  emit.log(`[Desktop] Cookies após login: PHPSESSID=${phpSessId?.slice(0,10) || 'N/A'}... entrance=${entranceCookie?.slice(0,10) || 'N/A'}...`, "info");
  emit.log(`[Desktop] Login resp body: '${loginResp.slice(0,100)}'`, "info");
  
  // Response "0" means success (location.replace('mystat'))
  if (loginResp === "0") {
    emit.log(`[Desktop] Login aceito em seo-fast.ru (resp=0)`, "success");
    // DO NOT navigate to /mystat here - it wastes the session
    // The checkWithdrawal function will access /mystat and /payment_user directly
    // with the correct referer (/register)
    return true;
  }
  
  // Response contains entrance_session value (success with session)
  if (loginResp.length === 32 && /^[a-fA-F0-9]+$/.test(loginResp)) {
    emit.log(`[Desktop] Login aceito com entrance_session`, "success");
    client.setCookie("entrance", loginResp);
    return true;
  }

  if (loginResp.includes("location.replace") || loginResp.includes("location.href")) {
    emit.log(`[Desktop] Login aceito em seo-fast.ru (redirect)`, "success");
    return true;
  }
  
  if (loginResp.includes("error_load") || loginResp.toLowerCase().includes("ошибка") || loginResp.includes("Неверный")) {
    emit.log(`[Desktop] Login recusado: ${loginResp.slice(0, 150)}`, "error");
    return false;
  }

  // Check if captcha is required
  if (loginResp.includes("captcha") || loginResp.includes("капча") || loginResp.includes("Капча")) {
    emit.log(`[Desktop] Captcha requerido para login desktop: ${loginResp.slice(0, 100)}`, "warn");
    return false;
  }

  // Try accessing payment_user to verify login worked
  await sleep(500);
  try {
    const checkResp = await client.request("GET", SEOFAST_DESKTOP_URL + "/payment_user", {
      headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/mystat"),
    });
    if (checkResp.text.includes("hash=") || checkResp.text.includes("bm-balance") || checkResp.text.includes("direction_faucetpay")) {
      emit.log(`[Desktop] Login confirmado via payment_user`, "success");
      return true;
    }
  } catch (e) {
    // Ignore check errors
  }

  emit.log(`[Desktop] Resposta login inesperada: ${loginResp.slice(0, 100)}`, "warn");
  return false;
}

// ============================================================
// CHECK WITHDRAWAL STATUS (uses existing session + desktop login)
// ============================================================

export interface WithdrawalCheckResult {
  status: WithdrawalAvailability;
  balance: string;
  message: string;
  paymentHash?: string;
}

/**
 * Check if withdrawal is available using existing session.
 * If no session exists, logs in first.
 * Now also authenticates on the desktop domain (seo-fast.ru) before accessing payment_user.
 */
export async function checkWithdrawal(
  email: string,
  password: string,
  emit: EmitFn
): Promise<WithdrawalCheckResult> {
  // Ensure session exists
  let session = sessions.get(email);
  if (!session || Date.now() - session.lastActivity > SESSION_TTL_MS) {
    const loginResult = await loginSession(email, password, emit);
    if (loginResult.status !== "connected") {
      return { status: "unknown", balance: "0", message: loginResult.message || "Falha no login" };
    }
    session = sessions.get(email)!;
  }

  emit.log(`[Saque] Verificando disponibilidade para ${email}...`, "info");
  session.lastActivity = Date.now();

  const { desktopClient } = session;

  // Login on desktop domain (seo-fast.ru) using separate cookie jar
  const desktopLoggedIn = await loginDesktop(desktopClient, email, password, emit);
  if (!desktopLoggedIn) {
    return { status: "unknown", balance: session.balance, message: "Falha no login desktop (seo-fast.ru)" };
  }

  await sleep(1000 + Math.random() * 500);

  // Step 1: "Warm up" the session with a dummy request to /mystat
  // The SEOFast server requires a first page load to activate the session
  // This first request will return non-authenticated content (expected)
  try {
    await desktopClient.request("GET", SEOFAST_DESKTOP_URL + "/mystat", {
      headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/login"),
    });
  } catch (e) {
    // Ignore - just warming up
  }

  await sleep(800 + Math.random() * 400);

  // Step 2: Access /mystat again with referer /register (this one works)
  try {
    const mystatResp = await desktopClient.request("GET", SEOFAST_DESKTOP_URL + "/mystat", {
      headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/register"),
    });
    const hasBalance = mystatResp.text.includes("bm-balance") || mystatResp.text.includes("balanceUp");
    emit.log(`[Desktop] /mystat após login: saldo=${hasBalance}, tamanho=${mystatResp.text.length}`, "info");
  } catch (e) {
    // Non-critical, continue
  }

  await sleep(500 + Math.random() * 500);

  // Step 3: Navigate to payment_user page
  // Use referer /mystat (we just visited it successfully)
  let resp: HttpResponse;
  try {
    resp = await desktopClient.request("GET", SEOFAST_DESKTOP_URL + "/payment_user", {
      headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/mystat"),
    });
  } catch (e: any) {
    emit.log(`Erro ao acessar payment_user: ${e.message?.slice(0, 80)}`, "error");
    return { status: "unknown", balance: session.balance, message: "Erro ao acessar payment_user" };
  }

  // Check if we got redirected to login (not authenticated)
  if (resp.text.includes("login-card") || resp.text.includes("Вход") && resp.text.length < 5000) {
    emit.log("Redirecionado para login — sessão desktop inválida", "error");
    return { status: "unknown", balance: session.balance, message: "Sessão desktop inválida" };
  }

  // Check if FaucetPay is temporarily unavailable
  // The page shows "Temporariamente Indisponível" or "Временно недоступно" next to the payment method
  const pageTextLower = resp.text.toLowerCase();
  const hasFaucetpaySection = resp.text.includes("faucetpay") || resp.text.includes("direction_faucetpay");
  const isTemporarilyUnavailable = 
    pageTextLower.includes("временно недоступно") ||
    pageTextLower.includes("temporarily unavailable") ||
    pageTextLower.includes("temporariamente indispon") ||
    pageTextLower.includes("временно\nнедоступно") ||
    pageTextLower.includes("временно<") && pageTextLower.includes("недоступно");

  // Check specifically if FaucetPay method is unavailable
  // Look for the faucetpay section and check if it has unavailable marker
  const faucetpayIdx = pageTextLower.indexOf("faucetpay");
  let faucetpayUnavailable = false;
  if (faucetpayIdx > -1) {
    // Check 500 chars around the faucetpay mention for unavailability markers
    const faucetpayContext = pageTextLower.slice(Math.max(0, faucetpayIdx - 200), faucetpayIdx + 300);
    faucetpayUnavailable = 
      faucetpayContext.includes("временно") ||
      faucetpayContext.includes("temporarily") ||
      faucetpayContext.includes("temporariamente") ||
      faucetpayContext.includes("недоступно") ||
      faucetpayContext.includes("unavailable") ||
      faucetpayContext.includes("indispon");
  }

  if (faucetpayUnavailable || (isTemporarilyUnavailable && !hasFaucetpaySection)) {
    const balance = extractBalance(resp.text) || session.balance;
    session.balance = balance;
    emit.log(`⚠️ Saque FaucetPay TEMPORARIAMENTE INDISPONÍVEL | Saldo: ${balance} руб.`, "error");
    return { 
      status: "unavailable" as any, 
      balance, 
      message: `Saque FaucetPay temporariamente indisponível. Tente novamente mais tarde. Saldo: ${balance} руб.` 
    };
  }

  // Extract hash from links on the listing page
  // The page has links like: /payment_user?pym=direction_faucetpay&hash=XXXXX&check=1
  let hash: string | null = null;
  
  // Try specific FaucetPay link first
  const faucetpayLinkMatch = resp.text.match(/payment_user\?pym=direction_faucetpay&(?:amp;)?hash=([a-fA-F0-9]{32})/i);
  if (faucetpayLinkMatch) {
    hash = faucetpayLinkMatch[1];
  }
  
  // Fallback: any hash in the page
  if (!hash) hash = extractPaymentHash(resp.text);
  if (!hash) {
    const hashMatch = resp.text.match(/hash=([a-fA-F0-9]{32})/);
    if (hashMatch) hash = hashMatch[1];
  }

  if (!hash) {
    // Log some debug info about the page content
    const pageLen = resp.text.length;
    const hasBalance = resp.text.includes("bm-balance") || resp.text.includes("balanceUp");
    emit.log(`Hash não encontrado. Página: ${pageLen} chars, tem saldo: ${hasBalance}`, "error");
    emit.log(`Conteúdo (primeiros 300 chars): ${resp.text.replace(/<[^>]+>/g, ' ').slice(0, 300)}`, "info");
    return { status: "no_wallet", balance: session.balance, message: "Hash não encontrado — carteira pode não estar configurada" };
  }

  emit.log(`Hash encontrado: ${hash.slice(0, 8)}...`, "info");
  await sleep(1000 + Math.random() * 1000);

  // Navigate to FaucetPay payment page with hash
  let resp2: HttpResponse;
  try {
    resp2 = await desktopClient.request(
      "GET",
      `${SEOFAST_DESKTOP_URL}/payment_user?pym=direction_faucetpay&hash=${hash}&check=1`,
      {
        headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/payment_user"),
      }
    );
  } catch (e: any) {
    emit.log(`Erro ao selecionar FaucetPay: ${e.message?.slice(0, 80)}`, "error");
    return { status: "unknown", balance: session.balance, message: "Erro ao acessar página FaucetPay" };
  }

  const pageText = resp2.text;
  const balance = extractBalance(pageText) || session.balance;
  session.balance = balance;

  // Determine status
  const hasPaymentForm = pageText.includes("payment_start") && pageText.includes("howmany");
  const needsVerification = pageText.includes("test_acc_pay") || pageText.includes("Отправить на проверку");
  const isPending = pageText.includes("ожидайте") || pageText.includes("подождите") || pageText.includes("На проверке") || pageText.includes("проверяется");

  if (hasPaymentForm) {
    emit.log(`Saque DISPONÍVEL | Saldo: ${balance} руб.`, "success");
    return { status: "available", balance, message: `Saque disponível. Saldo: ${balance} руб.`, paymentHash: hash };
  } else if (isPending) {
    emit.log(`Saque em análise (aguardando aprovação) | Saldo: ${balance} руб.`, "warn");
    return { status: "pending", balance, message: `Aprovação pendente. Saldo: ${balance} руб.` };
  } else if (needsVerification) {
    emit.log(`Saque requer aprovação (test_acc_pay) | Saldo: ${balance} руб.`, "warn");
    return { status: "requires_approval", balance, message: `Requer aprovação. Saldo: ${balance} руб.`, paymentHash: hash };
  } else {
    emit.log(`Carteira pode não estar configurada | Saldo: ${balance} руб.`, "warn");
    return { status: "no_wallet", balance, message: `Carteira FaucetPay não configurada. Saldo: ${balance} руб.` };
  }
}

// ============================================================
// REQUEST APPROVAL (test_acc_pay) using session
// ============================================================

export async function requestApproval(
  email: string,
  password: string,
  emit: EmitFn
): Promise<{ success: boolean; status: string; message: string }> {
  let session = sessions.get(email);
  if (!session || Date.now() - session.lastActivity > SESSION_TTL_MS) {
    const loginResult = await loginSession(email, password, emit);
    if (loginResult.status !== "connected") {
      return { success: false, status: "error", message: loginResult.message || "Falha no login" };
    }
    session = sessions.get(email)!;
  }

  emit.log(`[Aprovação] Enviando test_acc_pay para ${email}...`, "info");
  session.lastActivity = Date.now();

  const { desktopClient: deskClient } = session;

  // Ensure desktop login for seo-fast.ru AJAX
  await loginDesktop(deskClient, email, password, emit);

  const headers = desktopAjaxHeaders();
  headers["Referer"] = SEOFAST_DESKTOP_URL + "/payment_user";
  headers["Origin"] = SEOFAST_DESKTOP_URL;

  const data = new URLSearchParams({
    sf: "test_acc_pay",
    pym: "direction_faucetpay",
  }).toString();

  let resp: HttpResponse;
  try {
    resp = await deskClient.request("POST", SEOFAST_DESKTOP_URL + "/ajax/ajax_profile.php", {
      headers,
      body: data,
    });
  } catch (e: any) {
    emit.log(`Erro test_acc_pay: ${e.message?.slice(0, 80)}`, "error");
    return { success: false, status: "error", message: `Erro: ${e.message}` };
  }

  const responseText = resp.text.trim();
  emit.log(`Resposta test_acc_pay: ${responseText.slice(0, 100)}`, "info");

  if (responseText === "1" || responseText.includes("payment_start") || responseText.includes("howmany")) {
    emit.log("Conta aprovada para saque!", "success");
    return { success: true, status: "approved", message: "Conta aprovada para saque!" };
  } else if (responseText === "2" || responseText.includes("ожидайте") || responseText.includes("подождите")) {
    emit.log("Verificação já solicitada, aguardando aprovação...", "warn");
    return { success: false, status: "pending", message: "Aprovação já solicitada. Aguarde." };
  }

  return { success: false, status: "unknown", message: `Resposta: ${responseText.slice(0, 150)}` };
}

// ============================================================
// EXECUTE WITHDRAWAL (uses session)
// ============================================================

interface AntiBotQuestion {
  question: string;
  options: { value: string; text: string }[];
}

export function extractAntiBotQuestion(html: string): AntiBotQuestion | null {
  // Extract the <select> with the anti-bot options first.
  const selectMatch = html.match(/<select[^>]*id=['"]?select_q_bot_payment['"]?[^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) return null;

  const options: { value: string; text: string }[] = [];
  const optionRegex = /<option[^>]*value=['"]?([^'">\s]+)['"]?[^>]*>([^<]+)<\/option>/gi;
  let optMatch;
  while ((optMatch = optionRegex.exec(selectMatch[1])) !== null) {
    const value = optMatch[1];
    const text = optMatch[2].trim();
    // Skip the placeholder option (value 0) and any "select an option" prompt.
    if (value === "0") continue;
    if (/выберите|selecione|select an? option|choose/i.test(text)) continue;
    options.push({ value, text });
  }

  if (options.length === 0) return null;

  // The question text sits in a label/heading right before the select.
  // Look at the chunk of HTML preceding the <select> and grab the last
  // human-readable sentence ending with "?" (works for RU/PT/EN).
  const beforeSelect = html.slice(0, selectMatch.index ?? 0);
  let question = "";

  // Strip tags from the preceding chunk, then find the last question sentence.
  const textBefore = beforeSelect
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const questionMatches = textBefore.match(/[^.?!]*\?/g);
  if (questionMatches && questionMatches.length > 0) {
    question = questionMatches[questionMatches.length - 1].trim();
  }

  return { question, options };
}

/**
 * Resolve a pergunta anti-bot de associação semântica (ex.: "Qual destes você
 * pode comer?" → Melancia). Usa o LLM (que entende RU/PT/EN) para escolher a
 * opção correta entre as disponíveis. Retorna o `value` da opção escolhida.
 * Caso o LLM falhe, retorna null para que o chamador use um fallback.
 */
async function solveAntiBotQuestion(
  q: AntiBotQuestion,
  emit: EmitFn
): Promise<{ value: string; text: string } | null> {
  if (!q.question || q.options.length === 0) return null;

  const optionsList = q.options.map((o, i) => `${i + 1}. ${o.text}`).join("\n");
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You answer simple anti-bot association questions. The question and " +
            "options may be in Russian, Portuguese or English. Choose the single " +
            "option that correctly answers the question. Reply ONLY with the NUMBER " +
            "of the correct option (e.g. '3'), nothing else.",
        },
        {
          role: "user",
          content: `Pergunta: ${q.question}\nOpções:\n${optionsList}\n\nResponda apenas com o número da opção correta.`,
        },
      ],
    });

    const raw = (result?.choices?.[0]?.message?.content || "").toString().trim();
    if (!raw) return null;

    // 1) Preferir resposta por índice numérico (mais robusto).
    const numMatch = raw.match(/\d+/);
    if (numMatch) {
      const idx = parseInt(numMatch[0], 10) - 1;
      if (idx >= 0 && idx < q.options.length) {
        const chosen = q.options[idx];
        emit.log(`Resposta anti-bot resolvida (LLM): ${chosen.text}`, "info");
        return chosen;
      }
    }

    // 2) Reforço: match por texto exato ou parcial.
    const answer = raw.toLowerCase();
    const chosen =
      q.options.find((o) => o.text.trim().toLowerCase() === answer) ||
      q.options.find(
        (o) =>
          answer.includes(o.text.trim().toLowerCase()) ||
          o.text.trim().toLowerCase().includes(answer)
      );
    if (chosen) {
      emit.log(`Resposta anti-bot resolvida (LLM): ${chosen.text}`, "info");
      return chosen;
    }
    return null;
  } catch (e: any) {
    emit.log(`Falha ao resolver anti-bot via LLM: ${e?.message?.slice(0, 80)}`, "warn");
    return null;
  }
}

export async function executeWithdrawal(
  email: string,
  password: string,
  amount: number,
  emit: EmitFn,
  browserHeaders?: BrowserHeaders
): Promise<{ success: boolean; message: string; balance?: string }> {
  // Setar headers do navegador real
  if (browserHeaders) _sessionBrowserHeaders = browserHeaders;

  let session = sessions.get(email);
  if (!session || Date.now() - session.lastActivity > SESSION_TTL_MS) {
    const loginResult = await loginSession(email, password, emit, undefined, browserHeaders);
    if (loginResult.status !== "connected") {
      return { success: false, message: loginResult.message || "Falha no login" };
    }
    session = sessions.get(email)!;
  }

  emit.log(`[Saque] Executando saque de ${amount} руб. para ${email}...`, "info");
  session.lastActivity = Date.now();

  const { desktopClient: dClient } = session;

  // First check withdrawal status
  const checkResult = await checkWithdrawal(email, password, emit);

  if (checkResult.status === "requires_approval") {
    emit.log("Conta requer aprovação. Enviando test_acc_pay...", "info");
    const approval = await requestApproval(email, password, emit);
    if (!approval.success && approval.status !== "approved") {
      return { success: false, message: approval.message, balance: checkResult.balance };
    }
    await sleep(2000 + Math.random() * 1000);
  } else if (checkResult.status === "pending") {
    return { success: false, message: "Aprovação pendente. Aguarde e tente novamente.", balance: checkResult.balance };
  } else if (checkResult.status === "no_wallet") {
    return { success: false, message: "Carteira FaucetPay não configurada.", balance: checkResult.balance };
  } else if (checkResult.status === "unknown") {
    return { success: false, message: checkResult.message, balance: checkResult.balance };
  }

  // Navigate to payment page to get fresh form
  const hash = checkResult.paymentHash;
  if (!hash) {
    return { success: false, message: "Hash de pagamento não encontrado", balance: checkResult.balance };
  }

  let resp: HttpResponse;
  try {
    resp = await dClient.request(
      "GET",
      `${SEOFAST_DESKTOP_URL}/payment_user?pym=direction_faucetpay&hash=${hash}&check=1`,
      {
        headers: desktopPageHeaders(SEOFAST_DESKTOP_URL + "/payment_user"),
      }
    );
  } catch (e: any) {
    return { success: false, message: `Erro ao acessar formulário: ${e.message}`, balance: checkResult.balance };
  }

  const pageHtml = resp.text;
  if (!pageHtml.includes("payment_start") && !pageHtml.includes("howmany")) {
    return { success: false, message: "Formulário de pagamento não disponível", balance: checkResult.balance };
  }

  await sleep(1500 + Math.random() * 1000);

  // Extract fresh hash and anti-bot
  const freshHash = extractPaymentHash(pageHtml) || hash;
  const antiBotQuestion = extractAntiBotQuestion(pageHtml);
  let selectQBotPayment = "1";

  if (antiBotQuestion && antiBotQuestion.options.length > 0) {
    emit.log(`Pergunta anti-bot: ${antiBotQuestion.question || "(detectada)"}`, "info");
    // Resolve a pergunta de associação semântica com o LLM (entende RU/PT/EN).
    const solved = await solveAntiBotQuestion(antiBotQuestion, emit);
    if (!solved) {
      // Fallback seguro: não enviar uma resposta potencialmente errada (era a
      // causa do bug original). Abortamos o saque para evitar consumir
      // tentativas/saldo com uma resposta inválida.
      emit.log("Não foi possível resolver a pergunta anti-bot com segurança. Saque abortado.", "warn");
      return {
        success: false,
        message: "Não foi possível resolver a pergunta anti-bot automaticamente. Tente novamente.",
        balance: checkResult.balance,
      };
    }
    selectQBotPayment = solved.value;
    emit.log(`Resposta: ${solved.text}`, "info");
  }

  // Submit payment
  const paymentData = new URLSearchParams({
    sf: "payment",
    pym: "direction_faucetpay",
    c_choice: "4",
    captcha: "true",
    howmany: amount.toString(),
    hash: freshHash,
    select_q_bot_payment: selectQBotPayment,
    hcaptchaVal: "",
  }).toString();

  let payResp: HttpResponse;
  try {
    payResp = await dClient.request("POST", SEOFAST_DESKTOP_URL + "/ajax/ajax_payment.php", {
      headers: {
        ...desktopAjaxHeaders(),
        referer: `${SEOFAST_DESKTOP_URL}/payment_user?pym=direction_faucetpay&hash=${freshHash}&check=1`,
      },
      body: paymentData,
    });
  } catch (e: any) {
    return { success: false, message: `Erro na requisição de pagamento: ${e.message}`, balance: checkResult.balance };
  }

  const payResponse = payResp.text.trim();
  emit.log(`Resposta pagamento: ${payResponse.slice(0, 150)}`, "info");

  if (payResponse === "1") {
    emit.log(`Pagamento de ${amount} руб. realizado com sucesso!`, "success");
    return { success: true, message: `Saque de ${amount} руб. processado!`, balance: checkResult.balance };
  }

  if (payResponse.includes("галочку") || payResponse.includes("captcha")) {
    return { success: false, message: "hCaptcha obrigatório. Tente novamente.", balance: checkResult.balance };
  }
  if (payResponse.includes("Минимальная") || payResponse.includes("минимальная")) {
    return { success: false, message: "Valor abaixo do mínimo (30 руб.)", balance: checkResult.balance };
  }
  if (payResponse.includes("Недостаточно") || payResponse.includes("недостаточно")) {
    return { success: false, message: "Saldo insuficiente", balance: checkResult.balance };
  }
  if (payResponse.includes("ответ") || payResponse.includes("вопрос")) {
    return { success: false, message: "Resposta anti-bot incorreta. Tente novamente.", balance: checkResult.balance };
  }

  return { success: false, message: `Resposta: ${payResponse.slice(0, 200)}`, balance: checkResult.balance };
}

/**
 * SEOFast Withdrawal Approval Engine
 * Fluxo de pedido de aprovação de saque no SEO-Fast via FaucetPay
 *
 * Fluxo completo (baseado no HAR seo-fast5.ru.har):
 *  1. Login mobile (APK 1.1.1) no seo-fast.bz
 *  2. Navegar para payment_user (selecionar FaucetPay)
 *  3. Enviar para verificação (test_acc_pay)
 *  4. Após aprovação, submeter pedido de pagamento (ajax_payment.php)
 *     - Resolver hCaptcha
 *     - Responder pergunta anti-bot
 *     - Enviar com valor mínimo (30 rublos)
 */

import crypto from "crypto";
import https from "https";
import { URLSearchParams } from "url";
import type { EmitFn } from "./engine";
import { invokeLLM } from "../_core/llm";

// ============================================================
// CONFIG
// ============================================================

const SEOFAST_MOBILE_URL = "https://seo-fast.bz/webapp/";
const SEOFAST_DESKTOP_URL = "https://seo-fast.ru";
const SEOFAST_APP_VERSION = "1.1.1";
const SEOFAST_APP_SECRET = "seo_fast_SFk1gR5h5DGH";
const SEOFAST_PACKAGE_NAME = "com.example.seofast";

// ============================================================
// DEVICE PROFILES (same as seofast.ts)
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
  headers?: Record<string, string | string[] | undefined>;
}

class HttpClient {
  private cookies: Map<string, string> = new Map();
  private baseHeaders: Record<string, string>;

  constructor(baseHeaders: Record<string, string> = {}) {
    this.baseHeaders = baseHeaders;
  }

  setHeader(key: string, value: string) {
    this.baseHeaders[key] = value;
  }

  getCookieValue(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
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
          agent: tlsAgent,
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
            resolve({
              status: res.statusCode || 0,
              text: Buffer.concat(chunks).toString("utf-8"),
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
// MOBILE HEADERS
// ============================================================

function mobilePageHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Android WebView";v="138"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "Upgrade-Insecure-Requests": "1",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "X-Requested-With": SEOFAST_PACKAGE_NAME,
    "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate",
    "sec-fetch-user": "?1",
    "sec-fetch-dest": "document",
  };
}

function mobileAjaxLoginHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Android WebView";v="138"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
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

function profileAjaxHeaders(): Record<string, string> {
  return {
    "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Android WebView";v="138"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
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

function desktopAjaxHeaders(): Record<string, string> {
  return {
    accept: "*/*",
    "accept-language": "pt-BR,pt;q=0.9",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: "https://seo-fast.ru",
    "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
  };
}

// ============================================================
// HELPER: Extract hash_ajax from HTML
// ============================================================

function extractHashAjax(html: string): string | null {
  let m = html.match(/hash_ajax\s*=\s*['"]([a-fA-F0-9]{32})['"]/);
  if (!m) m = html.match(/var\s+hash_ajax\s*=\s*['"]([a-fA-F0-9]+)['"]/);
  return m ? m[1] : null;
}

// ============================================================
// HELPER: Extract payment hash from payment_user page
// ============================================================

function extractPaymentHash(html: string): string | null {
  // Look for hash in the payment_money function or hidden input
  let m = html.match(/'hash'\s*:\s*'([a-fA-F0-9]{32})'/);
  if (!m) m = html.match(/"hash"\s*:\s*"([a-fA-F0-9]{32})"/);
  if (!m) m = html.match(/hash\s*=\s*['"]([a-fA-F0-9]{32})['"]/);
  return m ? m[1] : null;
}

// ============================================================
// HELPER: Extract balance from page
// ============================================================

function extractBalance(html: string): string | null {
  // Look for balance display
  let m = html.match(/bm-balance[^>]*>([^<]+)</);
  if (!m) m = html.match(/balanceUp[^>]*>([^<]+)</);
  if (!m) m = html.match(/Основной счёт[^<]*<[^>]*>([0-9.,]+)/);
  return m ? m[1].trim() : null;
}

// ============================================================
// HELPER: Extract anti-bot question and options
// ============================================================

interface AntiBotQuestion {
  question: string;
  options: { value: string; text: string }[];
}

function extractAntiBotQuestion(html: string): AntiBotQuestion | null {
  // Extract the <select> with the anti-bot options first.
  const selectMatch = html.match(/<select[^>]*id=['"]?select_q_bot_payment['"]?[^>]*>([\s\S]*?)<\/select>/i);
  if (!selectMatch) return null;

  const options: { value: string; text: string }[] = [];
  const optionRegex = /<option[^>]*value=['"]?([^'">\s]+)['"]?[^>]*>([^<]+)<\/option>/gi;
  let optMatch;
  while ((optMatch = optionRegex.exec(selectMatch[1])) !== null) {
    const value = optMatch[1];
    const text = optMatch[2].trim();
    if (value === "0") continue;
    if (/выберите|selecione|select an? option|choose/i.test(text)) continue;
    options.push({ value, text });
  }

  if (options.length === 0) return null;

  // The question text sits in a label/heading right before the select.
  const beforeSelect = html.slice(0, selectMatch.index ?? 0);
  let question = "";
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
 * Resolve a pergunta anti-bot de associação semântica via LLM (RU/PT/EN).
 * Retorna a opção correta, ou null para o chamador usar fallback.
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

    // 2) Reforço: match por texto.
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

// ============================================================
// STEP 1: Login Mobile (APK 1.1.1)
// ============================================================

interface MobileSession {
  client: HttpClient;
  hashAjax: string;
  deviceId: string;
}

async function loginMobile(
  email: string,
  password: string,
  emit: EmitFn
): Promise<MobileSession | null> {
  emit.log("[Saque 1/4] Login via API Mobile (seo-fast.bz)...", "info");

  const deviceId = generateDeviceId();
  const appToken = generateAppToken(deviceId);
  const profile = getRandomProfile();

  emit.log(`Device: ${profile.hardware.model} | ID: ${deviceId.slice(0, 12)}...`, "info");

  const client = new HttpClient({
    "User-Agent": generateUserAgent(profile),
    "X-App-Token": appToken,
    "X-App-Version": SEOFAST_APP_VERSION,
    "X-Device-Id": deviceId,
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  // GET login page
  let resp: HttpResponse;
  try {
    resp = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=login", { headers: mobilePageHeaders() });
  } catch (e: any) {
    emit.log(`Erro GET login: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }

  const hashLogin = extractHashAjax(resp.text);
  if (!hashLogin) {
    emit.log("hash_ajax não encontrado na página de login", "error");
    return null;
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
    return null;
  }

  const loginResponse = resp2.text || "";
  if (loginResponse.includes("location.replace") && loginResponse.includes("pg=job")) {
    emit.log("Login aceito!", "success");
  } else if (loginResponse.includes("error_load") || loginResponse.toLowerCase().includes("ошибка")) {
    emit.log(`Login recusado: ${loginResponse.slice(0, 120)}`, "error");
    return null;
  } else if (loginResponse.includes("устарела")) {
    emit.log("Sessão expirada (hash antigo)", "error");
    return null;
  }

  await sleep(500 + Math.random() * 1000);

  // GET job page to get hash_ajax
  let resp3: HttpResponse;
  try {
    resp3 = await client.request("GET", SEOFAST_MOBILE_URL + "?pg=job", { headers: mobilePageHeaders() });
  } catch (e: any) {
    emit.log(`GET job: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }

  if (resp3.url.includes("pg=login") || resp3.text.includes("login-card")) {
    emit.log("Sessão não autenticada", "error");
    return null;
  }

  const hashAjax = extractHashAjax(resp3.text);
  if (!hashAjax) {
    emit.log("hash_ajax não encontrado na página job", "error");
    return null;
  }

  emit.log(`Sessão ativa | hash_ajax: ${hashAjax.slice(0, 8)}...`, "success");
  return { client, hashAjax, deviceId };
}

// ============================================================
// STEP 2: Navigate to payment_user and select FaucetPay
// ============================================================

interface PaymentPageInfo {
  hash: string;
  balance: string;
  hasPaymentForm: boolean;
  needsVerification: boolean;
  isPending: boolean;
}

async function navigateToPayment(
  session: MobileSession,
  emit: EmitFn
): Promise<PaymentPageInfo | null> {
  emit.log("[Saque 2/4] Navegando para página de pagamento...", "info");

  const { client } = session;

  // First, navigate to payment_user page
  let resp: HttpResponse;
  try {
    resp = await client.request("GET", SEOFAST_DESKTOP_URL + "/payment_user", {
      headers: {
        ...desktopAjaxHeaders(),
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        referer: SEOFAST_DESKTOP_URL + "/",
      },
    });
  } catch (e: any) {
    emit.log(`Erro ao acessar payment_user: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }

  // Extract hash from the page
  let hash = extractPaymentHash(resp.text);
  if (!hash) {
    // Try to find hash in the URL or links
    const hashMatch = resp.text.match(/hash=([a-fA-F0-9]{32})/);
    if (hashMatch) hash = hashMatch[1];
  }

  if (!hash) {
    emit.log("Hash de pagamento não encontrado na página", "error");
    return null;
  }

  emit.log(`Hash de pagamento: ${hash.slice(0, 8)}...`, "info");

  await sleep(1000 + Math.random() * 1000);

  // Navigate to FaucetPay payment page with hash
  let resp2: HttpResponse;
  try {
    resp2 = await client.request(
      "GET",
      `${SEOFAST_DESKTOP_URL}/payment_user?pym=direction_faucetpay&hash=${hash}&check=1`,
      {
        headers: {
          ...desktopAjaxHeaders(),
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          referer: SEOFAST_DESKTOP_URL + "/payment_user",
        },
      }
    );
  } catch (e: any) {
    emit.log(`Erro ao selecionar FaucetPay: ${e.message?.slice(0, 80)}`, "error");
    return null;
  }

  const pageText = resp2.text;
  const balance = extractBalance(pageText);
  if (balance) {
    emit.log(`Saldo disponível: ${balance} руб.`, "info");
  }

  // Check if payment form is already available or needs verification
  const hasPaymentForm = pageText.includes("payment_start") && pageText.includes("howmany");
  const needsVerification = pageText.includes("test_acc_pay") || pageText.includes("Отправить на проверку");
  // Detect pending state: verification was already sent but not yet approved
  const isPending = pageText.includes("ожидайте") || pageText.includes("подождите") || pageText.includes("На проверке") || pageText.includes("проверяется");

  return {
    hash,
    balance: balance || "0",
    hasPaymentForm,
    needsVerification,
    isPending,
  };
}

// ============================================================
// STEP 3: Request withdrawal approval (test_acc_pay)
// ============================================================

type ApprovalStatus = "approved" | "pending" | "error";

async function requestWithdrawalApproval(
  session: MobileSession,
  emit: EmitFn
): Promise<ApprovalStatus> {
  emit.log("[Saque 3/4] Solicitando aprovação de saque (test_acc_pay)...", "info");

  const { client } = session;
  const headers = profileAjaxHeaders();
  headers["Referer"] = SEOFAST_DESKTOP_URL + "/payment_user";
  headers["Origin"] = SEOFAST_DESKTOP_URL;

  const data = new URLSearchParams({
    sf: "test_acc_pay",
    pym: "direction_faucetpay",
  }).toString();

  let resp: HttpResponse;
  try {
    resp = await client.request("POST", SEOFAST_DESKTOP_URL + "/ajax/ajax_profile.php", {
      headers,
      body: data,
    });
  } catch (e: any) {
    emit.log(`Erro test_acc_pay: ${e.message?.slice(0, 80)}`, "error");
    return "error";
  }

  const responseText = resp.text.trim();
  emit.log(`Resposta test_acc_pay: ${responseText.slice(0, 100)}`, "info");

  if (responseText === "1") {
    emit.log("Conta aprovada para saque!", "success");
    return "approved";
  } else if (responseText === "2" || responseText.includes("ожидайте") || responseText.includes("подождите")) {
    emit.log("Verificação já solicitada, aguardando aprovação...", "warn");
    return "pending";
  } else if (responseText.includes("Войдите") || responseText.includes("войдите")) {
    emit.log("Sessão expirada", "error");
    return "error";
  }

  // Check if the response contains HTML indicating approval
  if (responseText.includes("payment_start") || responseText.includes("howmany")) {
    emit.log("Formulário de pagamento recebido — aprovado!", "success");
    return "approved";
  }

  emit.log(`Resposta inesperada: ${responseText.slice(0, 150)}`, "warn");
  return "pending";
}

// ============================================================
// STEP 4: Submit withdrawal payment
// ============================================================

interface WithdrawalResult {
  success: boolean;
  message: string;
}

async function submitWithdrawal(
  session: MobileSession,
  paymentInfo: PaymentPageInfo,
  amount: number,
  emit: EmitFn
): Promise<WithdrawalResult> {
  emit.log(`[Saque 4/4] Submetendo pedido de pagamento (${amount} руб.)...`, "info");

  const { client } = session;

  // Re-navigate to payment page to get fresh form data
  let resp: HttpResponse;
  try {
    resp = await client.request(
      "GET",
      `${SEOFAST_DESKTOP_URL}/payment_user?pym=direction_faucetpay&hash=${paymentInfo.hash}&check=1`,
      {
        headers: {
          ...desktopAjaxHeaders(),
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      }
    );
  } catch (e: any) {
    emit.log(`Erro ao recarregar página de pagamento: ${e.message?.slice(0, 80)}`, "error");
    return { success: false, message: "Erro ao acessar formulário de pagamento" };
  }

  const pageHtml = resp.text;

  // Extract the fresh hash from the payment form
  const freshHash = extractPaymentHash(pageHtml) || paymentInfo.hash;

  // Check if the form is available
  if (!pageHtml.includes("payment_start") && !pageHtml.includes("howmany")) {
    emit.log("Formulário de pagamento não disponível", "error");
    return { success: false, message: "Formulário de pagamento não encontrado. Conta pode não estar aprovada." };
  }

  await sleep(1500 + Math.random() * 1000);

  // For the anti-bot question, we'll try to extract and answer it
  // The select_q_bot_payment options are typically simple math or logic questions
  // We'll use a default answer strategy
  const antiBotQuestion = extractAntiBotQuestion(pageHtml);
  let selectQBotPayment = "1"; // Default answer

  if (antiBotQuestion && antiBotQuestion.options.length > 0) {
    emit.log(`Pergunta anti-bot: ${antiBotQuestion.question || "(detectada)"}`, "info");
    // Resolve a pergunta de associação semântica via LLM (entende RU/PT/EN).
    const solved = await solveAntiBotQuestion(antiBotQuestion, emit);
    if (!solved) {
      // Fallback seguro: abortar em vez de enviar uma resposta potencialmente
      // errada (causa do bug original).
      emit.log("Não foi possível resolver a pergunta anti-bot com segurança. Saque abortado.", "warn");
      return {
        success: false,
        message: "Não foi possível resolver a pergunta anti-bot automaticamente. Tente novamente.",
      };
    }
    selectQBotPayment = solved.value;
    emit.log(`Resposta selecionada: ${solved.text} (${selectQBotPayment})`, "info");
  }

  // Submit the payment request
  // Note: hCaptcha is required but we'll try without it first (some accounts bypass it)
  // The c_choice=4 means "question captcha" which doesn't need hcaptcha token
  const paymentData = new URLSearchParams({
    sf: "payment",
    pym: "direction_faucetpay",
    c_choice: "4",
    captcha: "true",
    howmany: amount.toString(),
    hash: freshHash,
    select_q_bot_payment: selectQBotPayment,
    hcaptchaVal: "", // Empty for question-based captcha
  }).toString();

  let payResp: HttpResponse;
  try {
    payResp = await client.request("POST", SEOFAST_DESKTOP_URL + "/ajax/ajax_payment.php", {
      headers: {
        ...desktopAjaxHeaders(),
        referer: `${SEOFAST_DESKTOP_URL}/payment_user?pym=direction_faucetpay&hash=${freshHash}&check=1`,
      },
      body: paymentData,
    });
  } catch (e: any) {
    emit.log(`Erro ao submeter pagamento: ${e.message?.slice(0, 80)}`, "error");
    return { success: false, message: `Erro na requisição de pagamento: ${e.message}` };
  }

  const payResponse = payResp.text.trim();
  emit.log(`Resposta pagamento: ${payResponse.slice(0, 150)}`, "info");

  if (payResponse === "1") {
    emit.log(`Pagamento de ${amount} руб. realizado com sucesso!`, "success");
    return { success: true, message: `Saque de ${amount} руб. aprovado e processado!` };
  }

  // Common error responses
  if (payResponse.includes("галочку") || payResponse.includes("captcha")) {
    emit.log("hCaptcha necessário — tentando com pergunta anti-bot...", "warn");
    return { success: false, message: "hCaptcha obrigatório. Tente novamente." };
  }

  if (payResponse.includes("Минимальная") || payResponse.includes("минимальная")) {
    emit.log("Valor abaixo do mínimo", "error");
    return { success: false, message: "Valor abaixo do mínimo permitido (30 руб.)" };
  }

  if (payResponse.includes("Недостаточно") || payResponse.includes("недостаточно")) {
    emit.log("Saldo insuficiente", "error");
    return { success: false, message: "Saldo insuficiente para saque" };
  }

  if (payResponse.includes("ответ") || payResponse.includes("вопрос")) {
    emit.log("Resposta anti-bot incorreta", "warn");
    return { success: false, message: "Resposta anti-bot incorreta. Tente novamente." };
  }

  return { success: false, message: `Resposta: ${payResponse.slice(0, 200)}` };
}

// ============================================================
// MAIN FLOW: Withdrawal Process
// ============================================================

export interface WithdrawInput {
  email: string;
  password: string;
  amount?: number; // Default: 30 (minimum)
}

export interface WithdrawResult {
  success: boolean;
  message: string;
  balance?: string;
  approvalStatus?: string;
}

export type WithdrawalAvailability = "available" | "requires_approval" | "pending" | "error" | "no_wallet";

export interface WithdrawCheckResult {
  status: WithdrawalAvailability;
  balance: string;
  message: string;
}

/**
 * Non-destructive check: login + navigateToPayment to determine if withdrawal is available.
 * Does NOT submit test_acc_pay or any payment.
 */
export async function checkWithdrawalStatus(
  email: string,
  password: string,
  emit: EmitFn
): Promise<WithdrawCheckResult> {
  emit.log(`Verificando disponibilidade de saque para ${email}...`, "info");

  // Step 1: Login
  const session = await loginMobile(email, password, emit);
  if (!session) {
    return { status: "error", balance: "0", message: "Falha no login SEOFast" };
  }

  // Step 2: Navigate to payment page (read-only)
  const paymentInfo = await navigateToPayment(session, emit);
  if (!paymentInfo) {
    return { status: "error", balance: "0", message: "Falha ao acessar página de pagamento" };
  }

  // Determine status based on page content
  if (paymentInfo.hasPaymentForm) {
    emit.log(`Saque DISPONÍVEL | Saldo: ${paymentInfo.balance} руб.`, "success");
    return { status: "available", balance: paymentInfo.balance, message: `Saque disponível. Saldo: ${paymentInfo.balance} руб.` };
  } else if (paymentInfo.isPending) {
    emit.log(`Saque em análise (aguardando aprovação) | Saldo: ${paymentInfo.balance} руб.`, "warn");
    return { status: "pending", balance: paymentInfo.balance, message: `Aprovação pendente. Aguarde a análise. Saldo: ${paymentInfo.balance} руб.` };
  } else if (paymentInfo.needsVerification) {
    emit.log(`Saque requer aprovação (test_acc_pay) | Saldo: ${paymentInfo.balance} руб.`, "warn");
    return { status: "requires_approval", balance: paymentInfo.balance, message: `Requer aprovação. Saldo: ${paymentInfo.balance} руб.` };
  } else {
    emit.log(`Status indeterminado. Carteira pode não estar configurada.`, "warn");
    return { status: "no_wallet", balance: paymentInfo.balance, message: `Carteira FaucetPay não configurada ou saldo insuficiente.` };
  }
}

export async function processWithdrawal(
  input: WithdrawInput,
  emit: EmitFn
): Promise<WithdrawResult> {
  const amount = input.amount || 30;

  emit.log(`=== Iniciando processo de saque SEOFast ===`, "info");
  emit.log(`Conta: ${input.email} | Valor: ${amount} руб.`, "info");
  emit.status("captcha", "running"); // Reusing status steps for withdrawal

  // Step 1: Login
  const session = await loginMobile(input.email, input.password, emit);
  if (!session) {
    emit.status("captcha", "failed");
    return { success: false, message: "Falha no login SEOFast" };
  }
  emit.status("captcha", "done");

  // Step 2: Navigate to payment page
  emit.status("register", "running");
  const paymentInfo = await navigateToPayment(session, emit);
  if (!paymentInfo) {
    emit.status("register", "failed");
    return { success: false, message: "Falha ao acessar página de pagamento" };
  }
  emit.status("register", "done");

  // Step 3: Request approval if needed
  emit.status("activate", "running");
  if (paymentInfo.needsVerification || !paymentInfo.hasPaymentForm) {
    const approval = await requestWithdrawalApproval(session, emit);
    if (approval === "error") {
      emit.status("activate", "failed");
      return {
        success: false,
        message: "Erro na aprovação de saque",
        balance: paymentInfo.balance,
        approvalStatus: "error",
      };
    }
    if (approval === "pending") {
      emit.status("activate", "done");
      emit.log("Aprovação pendente. Tente novamente em alguns minutos.", "warn");
      return {
        success: false,
        message: "Aprovação pendente. Aguarde e tente novamente.",
        balance: paymentInfo.balance,
        approvalStatus: "pending",
      };
    }
    // approved - continue to payment
    await sleep(2000 + Math.random() * 1000);
  }
  emit.status("activate", "done");

  // Step 4: Submit withdrawal
  emit.status("seofast_wallet", "running");
  const result = await submitWithdrawal(session, paymentInfo, amount, emit);
  
  if (result.success) {
    emit.status("seofast_wallet", "done");
  } else {
    emit.status("seofast_wallet", "failed");
  }

  return {
    success: result.success,
    message: result.message,
    balance: paymentInfo.balance,
    approvalStatus: result.success ? "approved" : "failed",
  };
}

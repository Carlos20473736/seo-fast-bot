/**
 * FaucetPay Auto Register Engine v3.0
 * 100% aligned with faucetpay_register.py
 *
 * Captcha: Slide (template matching) + Icons (OpenCV HSV + GPT-4o-mini Vision)
 * Activation: IMAP Gmail (app password)
 */

import crypto from "crypto";
import OpenAI from "openai";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { getDb } from "../db";
import { accounts, appConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createSeofastAccount } from "./seofast";
import { detectSlidePositionCV, findIconsCV } from "./captcha-cv";
import { resolveProxyConfig, proxyFetch, proxyLabel, type ProxyConfig } from "./proxy";

// ============================================================
// PROXY CONTEXT
// ============================================================

/**
 * Contexto de proxy propagado pelas funções de rede. `anchor` (geralmente o
 * e-mail da conta) garante IP fixo (sessid) durante todo o ciclo da conta.
 */
export interface ProxyContext {
  cfg: ProxyConfig;
  anchor?: string;
}

/** fetch com proxy aplicado a partir de um ProxyContext. */
function pf(pctx: ProxyContext | undefined, input: string | URL, init: RequestInit = {}): Promise<Response> {
  if (!pctx) return fetch(input, init);
  return proxyFetch(pctx.cfg, pctx.anchor, input, init);
}

// ============================================================
// TYPES
// ============================================================

export interface AccountData {
  username: string;
  email: string;
  password: string;
  referrer?: string;
  createSeofast?: boolean;
  existingAccount?: boolean;
}

/** Headers reais capturados do navegador do usuário */
export interface BrowserHeaders {
  "user-agent": string;
  "accept-language": string;
  "sec-ch-ua"?: string;
  "sec-ch-ua-mobile"?: string;
  "sec-ch-ua-platform"?: string;
  "screen-resolution"?: string;
  "device-pixel-ratio"?: string;
  "timezone"?: string;
  [key: string]: string | undefined;
}

export type LogType = "info" | "success" | "warn" | "error";
export type StepStatus = "idle" | "running" | "done" | "failed";
export type StepName = "captcha" | "register" | "activate" | "seofast_register" | "seofast_verify" | "seofast_wallet";

export interface EmitFn {
  log: (msg: string, type: LogType) => void;
  status: (step: StepName, status: StepStatus) => void;
  result: (data: { success: boolean; message: string; account?: any }) => void;
}

// ============================================================
// CONFIG - Exact match with Python script
// ============================================================

const SITE_KEY = "a3760bfe5cf4254b2759c19fb2601667";
const SITE_DOMAIN = "https://faucetpay.io";
const CAPTCHA_URL = "https://basiliskcaptcha.com";
const API_URL = "https://api.faucetpay.io";

// ============================================================
// BROWSER HEADERS - Constrói headers a partir dos dados reais do navegador
// ============================================================

/** Fallback headers caso o navegador não envie (não deve acontecer) */
const FALLBACK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const FALLBACK_LANG = "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7";
const FALLBACK_CH_UA = '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"';
const FALLBACK_CH_MOBILE = "?0";
const FALLBACK_CH_PLATFORM = '"Windows"';

/**
 * Constrói HEADERS para captcha (basilisk) usando headers reais do navegador.
 * Se browserHeaders não for fornecido, usa fallback.
 */
function buildCaptchaHeaders(bh?: BrowserHeaders): Record<string, string> {
  return {
    accept: "*/*",
    "accept-language": bh?.["accept-language"] || FALLBACK_LANG,
    "content-type": "text/plain;charset=UTF-8",
    origin: "https://faucetpay.io",
    referer: "https://faucetpay.io/",
    "sec-ch-ua": bh?.["sec-ch-ua"] || FALLBACK_CH_UA,
    "sec-ch-ua-mobile": bh?.["sec-ch-ua-mobile"] || FALLBACK_CH_MOBILE,
    "sec-ch-ua-platform": bh?.["sec-ch-ua-platform"] || FALLBACK_CH_PLATFORM,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "user-agent": bh?.["user-agent"] || FALLBACK_UA,
  };
}

/**
 * Constrói HEADERS_API para FaucetPay API usando headers reais do navegador.
 */
function buildApiHeaders(bh?: BrowserHeaders): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": bh?.["accept-language"] || FALLBACK_LANG,
    "content-type": "application/json",
    origin: "https://faucetpay.io",
    referer: "https://faucetpay.io/",
    "sec-ch-ua": bh?.["sec-ch-ua"] || FALLBACK_CH_UA,
    "sec-ch-ua-mobile": bh?.["sec-ch-ua-mobile"] || FALLBACK_CH_MOBILE,
    "sec-ch-ua-platform": bh?.["sec-ch-ua-platform"] || FALLBACK_CH_PLATFORM,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": bh?.["user-agent"] || FALLBACK_UA,
  };
}

/**
 * Constrói IMG_HEADERS para download de imagens.
 */
function buildImgHeaders(bh?: BrowserHeaders): Record<string, string> {
  return {
    referer: "https://faucetpay.io/",
    "user-agent": bh?.["user-agent"] || FALLBACK_UA,
  };
}

// Variáveis de módulo que são setadas por createAccountProcess/loginFaucetPay
// para que funções internas (solveCaptcha) possam acessar sem mudar todas as assinaturas
let _activeBrowserHeaders: BrowserHeaders | undefined = undefined;

// Getters para uso interno (mantém compatibilidade com código existente)
function getHEADERS(): Record<string, string> { return buildCaptchaHeaders(_activeBrowserHeaders); }
function getHEADERS_API(): Record<string, string> { return buildApiHeaders(_activeBrowserHeaders); }
function getIMG_HEADERS(): Record<string, string> { return buildImgHeaders(_activeBrowserHeaders); }

// Aliases para manter compatibilidade com referências existentes (getter properties)
// Usamos Object.defineProperty para que HEADERS/HEADERS_API/IMG_HEADERS sejam dinâmicos
const _headersProxy = {
  get HEADERS() { return getHEADERS(); },
  get HEADERS_API() { return getHEADERS_API(); },
  get IMG_HEADERS() { return getIMG_HEADERS(); },
};

// Re-export como constantes que são na verdade getters dinâmicos
const HEADERS = new Proxy({} as Record<string, string>, {
  get(_, prop: string) { return getHEADERS()[prop]; },
  ownKeys() { return Object.keys(getHEADERS()); },
  getOwnPropertyDescriptor(_, prop: string) {
    const h = getHEADERS();
    if (prop in h) return { value: h[prop], enumerable: true, configurable: true };
    return undefined;
  },
  has(_, prop: string) { return prop in getHEADERS(); },
});

const HEADERS_API = new Proxy({} as Record<string, string>, {
  get(_, prop: string) { return getHEADERS_API()[prop]; },
  ownKeys() { return Object.keys(getHEADERS_API()); },
  getOwnPropertyDescriptor(_, prop: string) {
    const h = getHEADERS_API();
    if (prop in h) return { value: h[prop], enumerable: true, configurable: true };
    return undefined;
  },
  has(_, prop: string) { return prop in getHEADERS_API(); },
});

const IMG_HEADERS = new Proxy({} as Record<string, string>, {
  get(_, prop: string) { return getIMG_HEADERS()[prop]; },
  ownKeys() { return Object.keys(getIMG_HEADERS()); },
  getOwnPropertyDescriptor(_, prop: string) {
    const h = getIMG_HEADERS();
    if (prop in h) return { value: h[prop], enumerable: true, configurable: true };
    return undefined;
  },
  has(_, prop: string) { return prop in getIMG_HEADERS(); },
});

// ============================================================
// CONFIG HELPERS
// ============================================================

export async function getConfig(): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(appConfig);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.configKey] = row.configValue;
  }
  return config;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(appConfig)
    .values({ configKey: key, configValue: value })
    .onDuplicateKeyUpdate({ set: { configValue: value } });
}

// ============================================================
// TRAIL GENERATION - Exact match with Python
// ============================================================

function generateSlideTrail(targetX: number) {
  const trailX: { timestamp: number; coord: number }[] = [];
  const trailY: { timestamp: number; coord: number }[] = [];
  let ct = Date.now();
  const numPoints = 60 + Math.floor(Math.random() * 16); // random.randint(60, 75)
  const startOffset = 5 + Math.floor(Math.random() * 6); // random.randint(5, 10)

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    let progress: number;
    if (t < 0.2) {
      progress = Math.pow(t / 0.2, 2) * 0.15;
    } else if (t < 0.7) {
      progress = 0.15 + ((t - 0.2) / 0.5) * 0.7;
    } else {
      progress = 0.85 + Math.pow((t - 0.7) / 0.3, 0.5) * 0.15;
    }

    let x = startOffset + Math.round(progress * (targetX - startOffset));
    x = Math.max(startOffset, Math.min(targetX, x + Math.floor(Math.random() * 3) - 1));
    if (i >= numPoints - 5) x = targetX;

    if (i > 0) {
      ct += Math.random() < 0.3
        ? 7 + Math.floor(Math.random() * 6) // random.randint(7, 12)
        : 1 + Math.floor(Math.random() * 3); // random.randint(1, 3)
    }

    trailX.push({ timestamp: ct, coord: x });
    const y =
      i < numPoints / 2
        ? Math.floor((i / numPoints) * 8)
        : Math.floor((1 - i / numPoints) * 8);
    trailY.push({ timestamp: ct, coord: Math.max(0, y) });
  }

  ct += 400 + Math.floor(Math.random() * 301); // random.randint(400, 700)
  trailX.push({ timestamp: ct, coord: targetX });
  trailY.push({ timestamp: ct, coord: trailY[trailY.length - 1].coord });

  return { trailX, trailY };
}

function generateMouseMovement(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startTime: number
) {
  const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
  const numPoints = Math.max(30, Math.round(distance * 0.8) + Math.floor(Math.random() * 21) - 10);
  const points: [number, number, number][] = [];
  let ct = startTime;

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    let progress: number;
    if (t < 0.5) {
      progress = 2 * t * t;
    } else {
      progress = 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    let x = startX + progress * (endX - startX) + (Math.random() - 0.5);
    let y = startY + progress * (endY - startY) + (Math.random() - 0.5);
    x = Math.round(x * 2) / 2;
    y = Math.round(y * 2) / 2;

    if (i > 0) ct += 1 + Math.floor(Math.random() * 5); // random.randint(1, 5)
    points.push([ct, x, y]);
  }

  points[points.length - 1] = [points[points.length - 1][0], endX, endY];
  return { points, endTime: ct };
}

function generateIconsTrail(coords: { x: number; y: number }[]) {
  const trailX: { timestamp: number; coord: number }[] = [];
  const trailY: { timestamp: number; coord: number }[] = [];
  let ct = Date.now();

  let currentX = coords[0].x;
  let currentY = coords[0].y;
  trailX.push({ timestamp: ct, coord: currentX });
  trailY.push({ timestamp: ct, coord: currentY });
  ct += 100 + Math.floor(Math.random() * 101); // random.randint(100, 200)

  for (let i = 1; i < coords.length; i++) {
    const targetX = coords[i].x;
    const targetY = coords[i].y;
    const { points, endTime } = generateMouseMovement(currentX, currentY, targetX, targetY, ct);

    for (let j = 1; j < points.length; j++) {
      trailX.push({ timestamp: points[j][0], coord: points[j][1] });
      trailY.push({ timestamp: points[j][0], coord: points[j][2] });
    }

    ct = endTime + 80 + Math.floor(Math.random() * 121); // random.randint(80, 200)
    trailX.push({ timestamp: ct, coord: targetX });
    trailY.push({ timestamp: ct, coord: targetY });
    currentX = targetX;
    currentY = targetY;
  }

  // Move away after clicks (matches Python)
  const awayX = Math.round((currentX + (Math.random() - 0.5) * 100) * 2) / 2;
  const awayY = Math.round(Math.min(300, Math.max(0, currentY + 50 + Math.random() * 100)) * 2) / 2;
  ct += 100 + Math.floor(Math.random() * 101);
  const { points: awayPoints, endTime: awayEnd } = generateMouseMovement(currentX, currentY, awayX, awayY, ct);

  for (let j = 1; j < awayPoints.length; j++) {
    trailX.push({ timestamp: awayPoints[j][0], coord: awayPoints[j][1] });
    trailY.push({ timestamp: awayPoints[j][0], coord: awayPoints[j][2] });
  }

  ct = awayEnd + 100 + Math.floor(Math.random() * 101);
  trailX.push({ timestamp: ct, coord: trailX[trailX.length - 1].coord });
  trailY.push({ timestamp: ct, coord: trailY[trailY.length - 1].coord });

  return { trailX, trailY };
}

// ============================================================
// CAPTCHA SOLVER - Aligned with Python OpenCV + GPT approach
// ============================================================

/**
 * Detect slide position (template matching) using a pure-Node implementation
 * (sharp + JS), equivalent to the previous Python/OpenCV cv2.matchTemplate.
 * Runs on the Node-only deploy runtime (no Python required).
 */
async function detectSlidePosition(
  bgBuffer: Buffer,
  slideBuffer: Buffer
): Promise<{ x: number; confidence: number }> {
  return detectSlidePositionCV(bgBuffer, slideBuffer);
}

/**
 * Find neon icons via HSV detection, pure-Node implementation (sharp + JS),
 * equivalent to the previous Python/OpenCV find_icons_opencv.
 */
async function findIconsOpenCV(
  imgBuffer: Buffer
): Promise<{ cx: number; cy: number; w: number; h: number; area: number; crop: Buffer }[]> {
  return findIconsCV(imgBuffer);
}

/**
 * Identify icons using GPT-4o-mini Vision via OpenAI original API.
 * Uses the EXACT same prompt and logic as the working Python script.
 */
async function identifyIconsGPT(
  iconCrops: Buffer[],
  openaiKey: string,
  fullImageBuffer?: Buffer
): Promise<{ icons?: { position: number; name: string }[] }> {
  // Use OpenAI original API (same as Python script)
  const client = new OpenAI({
    apiKey: openaiKey,
    baseURL: "https://api.openai.com/v1",
  });

  // EXACT same prompt as the Python script
  const content: any[] = [
    {
      type: "text",
      text: `I have 3 neon icon crops from a captcha. Identify each one.
Possible types: star (5-pointed star shape), buy (shopping cart with wheels), calendar (square calendar icon with details on top).
Reply ONLY with JSON: {"icons": [{"position": 1, "name": "type"}, {"position": 2, "name": "type"}, {"position": 3, "name": "type"}]}`,
    },
  ];

  // Add crops EXACTLY like Python script (no full image, just crops)
  for (let i = 0; i < iconCrops.length; i++) {
    content.push({ type: "text", text: `Icon ${i + 1}:` });
    content.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${iconCrops[i].toString("base64")}` },
    });
  }

  // Use gpt-4o-mini (same as Python script)
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content }],
      max_tokens: 200,
      temperature: 0.0,
    });

    let result = response.choices[0].message.content?.trim() || "{}";

    // Clean markdown code blocks (same as Python)
    if (result.includes("```")) {
      const parts = result.split("```");
      result = parts.length >= 2 ? parts[1] : result;
      if (result.startsWith("json")) result = result.slice(4);
      result = result.trim();
    }

    // Try to extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = jsonMatch[0];
    }

    const data = JSON.parse(result) as { icons?: { position: number; name: string }[] };

    // Validate response
    if (data.icons && Array.isArray(data.icons) && data.icons.length >= 3) {
      const validNames = ["star", "buy", "calendar"];
      const allValid = data.icons.every(i => validNames.includes(i.name));
      if (allValid) return data;
    }
  } catch (e: any) {
    // Log error for debugging
    console.error("[GPT Icons] Error:", e.message || e);
  }

  return {};
}

// ============================================================
// CAPTCHA SOLVER - Main function (matches Python's solve_captcha)
// ============================================================

async function solveCaptcha(
  emit: EmitFn,
  config: Record<string, string>,
  maxRetries = 8,
  pctx?: ProxyContext
): Promise<string | null> {
  const openaiKey = config.openai_api_key;
  if (!openaiKey) {
    emit.log("OpenAI API Key não configurada!", "error");
    return null;
  }

  const basePayload = { site_key: SITE_KEY, site_domain: SITE_DOMAIN };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    emit.log(`Captcha tentativa ${attempt + 1}/${maxRetries}...`, "info");

    try {
      // 1. Check site (matches Python)
      await pf(pctx, `${CAPTCHA_URL}/challenge/check-site`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(basePayload),
      });

      // 2. Create challenge
      const createResp = await pf(pctx, `${CAPTCHA_URL}/challenge/create-challenge`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(basePayload),
      });
      const createData = (await createResp.json()) as any;
      if (!createData.success) {
        await sleep(2000);
        continue;
      }

      const challenge = createData.data;
      const captchaId = challenge.captcha_id;

      // 3. Download background and slide images
      const bgResp = await pf(pctx, challenge.background_url, { headers: IMG_HEADERS });
      const slResp = await pf(pctx, challenge.slide_url, { headers: IMG_HEADERS });
      const bgBuffer = Buffer.from(await bgResp.arrayBuffer());
      const slBuffer = Buffer.from(await slResp.arrayBuffer());

      // 4. Detect slide position (template matching - proven reliable)
      const { x: targetX, confidence } = await detectSlidePosition(bgBuffer, slBuffer);
      emit.log(`Slide: X=${targetX}, conf=${confidence.toFixed(3)}`, "info");

      // Skip if confidence is too low (likely wrong detection)
      if (confidence < 0.85) {
        emit.log(`Confiança baixa (${confidence.toFixed(3)}), retry...`, "warn");
        await sleep(1000);
        continue;
      }

      // 5. Wait (matches Python's time.sleep(random.uniform(1.5, 2.5)))
      await sleep(1500 + Math.random() * 1000);
      const { trailX, trailY } = generateSlideTrail(targetX);

      // 6. Slide verify
      const slideResp = await pf(pctx, `${CAPTCHA_URL}/challenge/slide-verify`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          captcha_id: captchaId,
          trail_x: trailX,
          trail_y: trailY,
        }),
      });
      const slideResult = (await slideResp.json()) as any;
      if (!slideResult.success) {
        emit.log("Slide falhou, retry...", "warn");
        await sleep(1000);
        continue;
      }

      emit.log("Slide OK!", "success");

      // 7. Icons challenge (matches Python)
      await sleep(800 + Math.random() * 700); // time.sleep(random.uniform(0.8, 1.5))
      const iconsResp = await pf(pctx, `${CAPTCHA_URL}/challenge/icons-challenge`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ ...basePayload, captcha_id: captchaId }),
      });
      const iconsData = (await iconsResp.json()) as any;
      if (!iconsData.success) continue;

      const iconsOrder: string[] = iconsData.data.icons_order;
      emit.log(`Ícones: ${iconsOrder.join(", ")}`, "info");

      // 8. Download icons image
      const iconsImgResp = await pf(pctx, iconsData.data.background_url, { headers: IMG_HEADERS });
      const iconsBuffer = Buffer.from(await iconsImgResp.arrayBuffer());

      // 9. Find icons via OpenCV-like HSV detection (matches Python's find_icons_opencv)
      const iconsFound = await findIconsOpenCV(iconsBuffer);

      if (iconsFound.length < 3) {
        emit.log(`Poucos ícones detectados (${iconsFound.length}), retry...`, "warn");
        continue;
      }

      // 10. Identify icons with GPT-5 Vision (with internal retry)
      emit.log("Identificando com GPT-5...", "info");
      const crops = iconsFound.map((icon) => icon.crop);

      // Try identification up to 2 times
      let gptResult: { icons?: { position: number; name: string }[] } = {};
      for (let gptAttempt = 0; gptAttempt < 2; gptAttempt++) {
        gptResult = await identifyIconsGPT(crops, openaiKey, iconsBuffer);
        if (gptResult.icons && gptResult.icons.length >= 3) break;
        if (gptAttempt === 0) {
          emit.log("GPT não identificou, tentando novamente...", "warn");
          await sleep(500);
        }
      }

      // Build name -> icon map (matches Python logic)
      const nameMap: Record<string, { cx: number; cy: number }> = {};
      if (gptResult.icons) {
        for (const item of gptResult.icons) {
          const pos = item.position - 1;
          if (pos >= 0 && pos < iconsFound.length) {
            nameMap[item.name] = { cx: iconsFound[pos].cx, cy: iconsFound[pos].cy };
          }
        }
      }

      const identified = Object.entries(nameMap).map(([k, v]) => `${k}:(${v.cx},${v.cy})`).join(", ");
      emit.log(`→ ${identified || "VAZIO - GPT não retornou"}`, identified ? "info" : "warn");

      // 11. Build coords in order (matches Python)
      const coords: { x: number; y: number }[] = [];
      let ok = true;
      for (const name of iconsOrder) {
        if (name in nameMap) {
          coords.push({ x: nameMap[name].cx + 0.5, y: nameMap[name].cy + 0.5 });
        } else {
          ok = false;
          break;
        }
      }
      if (!ok || coords.length < 3) {
        emit.log(`Ícones não identificados (faltou: ${iconsOrder.filter(n => !(n in nameMap)).join(", ")}), retry...`, "warn");
        continue;
      }

      // 12. Generate trail and verify (matches Python)
      await sleep(300 + Math.random() * 500); // time.sleep(random.uniform(0.3, 0.8))
      const iconsTrail = generateIconsTrail(coords);

      const verifyResp = await pf(pctx, `${CAPTCHA_URL}/challenge/icons-verify`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          ...basePayload,
          captcha_id: captchaId,
          coords,
          trail_x: iconsTrail.trailX,
          trail_y: iconsTrail.trailY,
        }),
      });
      const verifyResult = (await verifyResp.json()) as any;

      if (verifyResult.success) {
        const token = verifyResult.data.captcha_response;
        emit.log(`Captcha resolvido! Token: ${token.slice(0, 20)}...`, "success");
        return token;
      } else {
        emit.log("icons-verify falhou, retry...", "warn");
      }
    } catch (e: any) {
      emit.log(`Erro: ${e.message?.slice(0, 80)}`, "error");
    }

    await sleep(1000);
  }

  return null;
}

// ============================================================
// IMAP ACTIVATION - Matches Python's wait_for_verification_email + activate_account
// ============================================================

/**
 * Extract verification link from email body.
 * Matches Python's extract_verification_link with multiple patterns.
 */
function extractVerificationLink(body: string): string | null {
  const patterns = [
    /https?:\/\/faucetpay\.io\/account\/confirm-email\/[a-f0-9]+/gi,
    /https?:\/\/faucetpay\.io\/account\/confirm[^\s"'<>]+/gi,
    /https?:\/\/faucetpay\.io\/account\/activate[^\s"'<>]+/gi,
    /https?:\/\/faucetpay\.io\/account\/verify[^\s"'<>]+/gi,
    /https?:\/\/faucetpay\.io\/[^\s"'<>]*(?:activate|verify|confirm)[^\s"'<>]*/gi,
  ];

  for (const pattern of patterns) {
    const matches = body.match(pattern);
    if (matches && matches.length > 0) {
      let link = matches[0];
      link = link.replace(/&amp;/g, "&");
      return link;
    }
  }

  // Fallback: any faucetpay link with /account/ (matches Python)
  const allLinks = body.match(/https?:\/\/[^\s"'<>]*faucetpay[^\s"'<>]+/gi);
  if (allLinks) {
    for (const link of allLinks) {
      if (link.includes("/account/") && link !== "https://faucetpay.io/") {
        return link.replace(/&amp;/g, "&");
      }
    }
  }

  return null;
}

/**
 * Search a single mailbox for FaucetPay verification email.
 * Returns the activation link if found, null otherwise.
 */
async function searchMailboxForLink(
  client: InstanceType<typeof ImapFlow>,
  mailbox: string,
  emit: EmitFn
): Promise<string | null> {
  let lock;
  try {
    lock = await client.getMailboxLock(mailbox);
  } catch {
    // Mailbox doesn't exist (e.g., no [Gmail]/Spam)
    return null;
  }

  try {
    // Search queries: first UNSEEN, then ALL (catches already-read emails)
    const searchQueries = [
      { seen: false, from: "m.faucetpay.io" },
      { seen: false, from: "faucetpay" },
      { seen: false, subject: "Confirm your email" },
      { seen: false, subject: "confirm" },
      // Fallback: search ALL (including SEEN) — fixes the main bug
      { from: "m.faucetpay.io" },
      { from: "faucetpay" },
      { subject: "Confirm your email" },
    ];

    const msgList: { source: any }[] = [];

    for (const query of searchQueries) {
      if (msgList.length > 0) break;
      try {
        const messages = client.fetch(query as any, { source: true });
        for await (const msg of messages) {
          if (msg.source) msgList.push({ source: msg.source });
        }
      } catch {
        // Try next search query
      }
    }

    // Process in reverse (newest first)
    const toCheck = msgList.slice(-5).reverse();

    for (const msg of toCheck) {
      const parsed: ParsedMail = await simpleParser(msg.source);
      const fromAddr = (parsed.from?.text || "").toLowerCase();
      const subject = (parsed.subject || "").toLowerCase();

      if (
        fromAddr.includes("faucetpay") ||
        subject.includes("faucetpay") ||
        subject.includes("verify") ||
        subject.includes("activate") ||
        subject.includes("confirm")
      ) {
        const body = (parsed.html || parsed.textAsHtml || parsed.text || "") as string;
        emit.log(`→ Email encontrado: ${(parsed.subject || "").slice(0, 50)}`, "info");

        const link = extractVerificationLink(body);
        if (link) return link;
      }
    }
  } finally {
    try { lock.release(); } catch {}
  }

  return null;
}

/**
 * Wait for verification email and activate account.
 * Searches INBOX + Spam folder, both UNSEEN and SEEN emails.
 */
async function waitAndActivate(
  userEmail: string,
  emit: EmitFn,
  config: Record<string, string>,
  maxWait = 120,
  checkInterval = 10,
  pctx?: ProxyContext
): Promise<boolean> {
  const loginEmail = config.gmail_login_email;
  const appPassword = config.gmail_app_password;

  if (!loginEmail || !appPassword) {
    emit.log("Credenciais Gmail não configuradas!", "error");
    return false;
  }

  emit.log(`Aguardando email de verificação...`, "info");
  emit.log(`Email: ${userEmail}`, "info");
  emit.log(`Timeout: ${maxWait}s`, "info");

  // Wait 10s for email to arrive
  await sleep(10000);

  const startTime = Date.now();
  // Mailboxes to search (INBOX + common spam folder names)
  const mailboxes = ["INBOX", "[Gmail]/Spam", "[Gmail]/Lixo eletr\u00f4nico", "Junk"];

  while (Date.now() - startTime < maxWait * 1000) {
    try {
      const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: loginEmail, pass: appPassword },
        logger: false as any,
      });

      await client.connect();

      let link: string | null = null;

      for (const mailbox of mailboxes) {
        link = await searchMailboxForLink(client, mailbox, emit);
        if (link) break;
      }

      if (link) {
        emit.log(`Link de ativação encontrado!`, "success");
        emit.log(`Ativando conta...`, "info");

        const activationHash = link.replace(/\/$/, "").split("/").pop()!;
        emit.log(`Hash: ${activationHash.slice(0, 20)}...`, "info");

        const resp = await pf(pctx, `${API_URL}/account/confirm-account`, {
          method: "POST",
          headers: HEADERS_API,
          body: JSON.stringify({ activation_hash: activationHash }),
          signal: AbortSignal.timeout(30000),
        });
        const result = (await resp.json()) as any;

        await client.logout();

        if (result.success) {
          emit.log("Conta ativada com sucesso!", "success");
          return true;
        } else {
          const msg = result.message || "Erro desconhecido";
          emit.log(`Falha: ${msg}`, "warn");
          if (msg.toLowerCase().includes("invalid")) {
            emit.log("(O link pode já ter sido usado - conta pode já estar ativa)", "info");
          }
          return false;
        }
      }

      await client.logout();
    } catch (e: any) {
      emit.log(`Erro IMAP: ${e.message?.slice(0, 80)}`, "warn");
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    emit.log(`Aguardando... (${elapsed}s/${maxWait}s)`, "info");
    await sleep(checkInterval * 1000);
  }

  emit.log(`Timeout! Email não chegou em ${maxWait}s.`, "error");
  return false;
}

/**
 * Test IMAP connection with provided credentials.
 * Returns success/failure with diagnostic message.
 */
export async function testImapConnection(
  loginEmail: string,
  appPassword: string
): Promise<{ success: boolean; message: string; details?: string }> {
  let client: ImapFlow | null = null;
  try {
    client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: loginEmail, pass: appPassword },
      logger: false as any,
      // Evita travar indefinidamente caso o servidor não responda
      socketTimeout: 20000,
      greetingTimeout: 15000,
      connectionTimeout: 15000,
    } as any);

    // Silencia eventos de erro do socket para não derrubar o processo
    client.on("error", () => {});

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let status: { messages?: number; unseen?: number };
    try {
      status = await client.status("INBOX", { messages: true, unseen: true });
    } finally {
      lock.release();
    }
    await client.logout();

    return {
      success: true,
      message: `Conexão OK! ${status.messages || 0} emails na caixa, ${status.unseen || 0} não lidos.`,
    };
  } catch (e: any) {
    // imapflow lança e.message = "Command failed" genérico; as infos úteis ficam
    // em responseText / serverResponseCode / authenticationFailed.
    const responseText = String(e?.responseText || "");
    const serverCode = String(e?.serverResponseCode || "");
    const rawMsg = String(e?.message || "");
    const combined = `${serverCode} ${responseText} ${rawMsg} ${e?.code || ""}`.trim();
    let details = "";
    if (
      e?.authenticationFailed ||
      /Invalid credentials|AUTHENTICATIONFAILED|Application-specific password|WEBLOGIN/i.test(combined)
    ) {
      details =
        "Credenciais inválidas. Use uma App Password (16 caracteres, sem espaços) e confirme o e-mail de login. A senha normal da conta não funciona via IMAP, e o IMAP precisa estar ativado no Gmail.";
    } else if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|timeout/i.test(combined)) {
      details =
        "Não foi possível conectar ao servidor IMAP (imap.gmail.com:993). Verifique a rede e se o IMAP está ativado no Gmail.";
    } else {
      details = (responseText || rawMsg || "Erro desconhecido").slice(0, 150);
    }
    return { success: false, message: "Falha na conexão IMAP", details };
  } finally {
    // Garante que a conexão seja encerrada mesmo em caso de erro
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Reactivate a pending account by searching for the verification email.
 */
export async function reactivateAccount(
  accountEmail: string,
  emit: EmitFn
): Promise<boolean> {
  const config = await getConfig();
  const pctx: ProxyContext = { cfg: resolveProxyConfig(config), anchor: accountEmail };
  emit.log(`Tentando reativar: ${accountEmail}`, "info");
  emit.log(`Proxy: ${proxyLabel(pctx.cfg, pctx.anchor)}`, "info");
  emit.status("activate", "running");

  const activated = await waitAndActivate(accountEmail, emit, config, 60, 8, pctx);

  if (activated) {
    emit.status("activate", "done");
    // Update DB status
    const db = await getDb();
    if (db) {
      await db.update(accounts).set({ status: "ativada" }).where(eq(accounts.email, accountEmail));
    }
    emit.result({ success: true, message: "Conta reativada com sucesso!" });
  } else {
    emit.status("activate", "failed");
    emit.result({ success: false, message: "Não foi possível encontrar o email de ativação." });
  }

  return activated;
}

// ============================================================
// MAIN PROCESS - Matches Python's create_account flow
// ============================================================

export async function createAccountProcess(data: AccountData, emit: EmitFn, browserHeaders?: BrowserHeaders): Promise<void> {
  // Seta os headers do navegador real para uso em todas as requisições deste ciclo
  _activeBrowserHeaders = browserHeaders;
  if (browserHeaders) {
    emit.log(`[Headers] UA: ${browserHeaders["user-agent"]?.slice(0, 60)}... | Lang: ${browserHeaders["accept-language"]?.slice(0, 20)}`, "info");
  }

  const config = await getConfig();
  // IP fixo (sessid) por conta: todo o ciclo desta conta usa o mesmo IP.
  const pctx: ProxyContext = { cfg: resolveProxyConfig(config), anchor: data.email };

  emit.log(`Iniciando ${data.existingAccount ? "vinculação de conta existente" : "registro"}: ${data.username}`, "info");
  emit.log(`Email: ${data.email}`, "info");
  emit.log(`Proxy: ${proxyLabel(pctx.cfg, pctx.anchor)}`, "info");
  if (data.referrer) emit.log(`Referral: ${data.referrer}`, "info");

  let activated = false;

  if (data.existingAccount) {
    emit.log("Modo conta existente: pulando captcha, registro e ativação.", "info");
    emit.status("captcha", "done");
    emit.status("register", "done");
    emit.status("activate", "done");
    activated = true;
  } else {
    emit.status("captcha", "running");
    // ─── RESOLVER CAPTCHA ─── (matches Python [1/3])
    emit.log("[1/3] Resolvendo captcha...", "info");
    const captchaResponse = await solveCaptcha(emit, config, 8, pctx);
    if (!captchaResponse) {
      emit.status("captcha", "failed");
      emit.result({ success: false, message: "Não foi possível resolver o captcha." });
      return;
    }

    emit.status("captcha", "done");
    emit.status("register", "running");

    // ─── REGISTRAR ─── (matches Python [2/3])
    emit.log("[2/3] Registrando conta...", "info");

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let xDigitalKey = "";
    for (let i = 0; i < 16; i++) {
      xDigitalKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const yDigitalKey = crypto
      .createHash("md5")
      .update(`${data.email}${Date.now() / 1000}${Math.random()}`)
      .digest("hex");

    const tag = crypto
      .createHash("md5")
      .update(`${data.username}${data.email}${Math.random()}`)
      .digest("hex");

    const registerPayload = {
      user_name: data.username,
      user_email: data.email,
      password: data.password,
      referrer: data.referrer || "",
      captcha_response: captchaResponse,
      x_digital_key: xDigitalKey,
      y_digital_key: yDigitalKey,
      tag,
    };

    try {
      await sleep(500 + Math.random() * 1000);

      const resp = await pf(pctx, `${API_URL}/account/register`, {
        method: "POST",
        headers: HEADERS_API,
        body: JSON.stringify(registerPayload),
      });
      const result = (await resp.json()) as any;

      if (!result.success) {
        emit.status("register", "failed");
        emit.log(`Registro falhou: ${JSON.stringify(result)}`, "error");
        emit.result({ success: false, message: result.message || "Erro no registro" });

        const db = await getDb();
        if (db) {
          await db.insert(accounts).values({
            username: data.username,
            email: data.email,
            password: data.password,
            referrer: data.referrer || null,
            status: "falhou",
            createdAt: Date.now(),
          });
        }
        return;
      }

      emit.log(`✓ Conta criada! ${result.message || ""}`, "success");
    } catch (e: any) {
      emit.status("register", "failed");
      emit.result({ success: false, message: `Erro: ${e.message}` });
      return;
    }

    emit.status("register", "done");

    // ─── ATIVAR VIA EMAIL ─── (matches Python [3/3])
    emit.status("activate", "running");
    emit.log("[3/3] Ativação automática via IMAP...", "info");

    activated = await waitAndActivate(data.email, emit, config, 120, 10, pctx);
  }

  // Save to database
  const db = await getDb();
  const accountRecord = {
    username: data.username,
    email: data.email,
    password: data.password,
    referrer: data.referrer || null,
    status: activated ? ("ativada" as const) : ("pendente" as const),
    createdAt: Date.now(),
    createSeofast: data.createSeofast ? 1 : 0,
  };

  if (db) {
    await db.insert(accounts).values(accountRecord);
  }

  if (activated) {
    emit.status("activate", "done");
  } else {
    emit.status("activate", "failed");
  }

  // ============================================================
  // FASE 2: SEOFAST (se solicitado)
  // ============================================================
  if (data.createSeofast) {
    emit.log("Iniciando fluxo SEOFast...", "info");
    emit.status("seofast_register", "running");
    
    const sfResult = await createSeofastAccount(config, data.email, data.email, undefined, emit, browserHeaders);
    
    if (sfResult.success) {
      emit.status("seofast_register", "done");
      emit.status("seofast_verify", "done");
      emit.status("seofast_wallet", "done");
      if (db) {
        await db.update(accounts).set({
          seofastUsername: sfResult.username,
          seofastPassword: sfResult.password,
          seofastStatus: "ativada"
        }).where(eq(accounts.email, data.email));
      }
      
      emit.result({ 
        success: true, 
        message: "Contas FaucetPay e SEOFast criadas e ativadas!",
        account: { ...accountRecord, seofastUsername: sfResult.username, seofastStatus: "ativada" }
      });
    } else {
      emit.status("seofast_register", "failed");
      if (db) {
        await db.update(accounts).set({
          seofastUsername: sfResult.username,
          seofastPassword: sfResult.password,
          seofastStatus: "falhou"
        }).where(eq(accounts.email, data.email));
      }
      
      emit.result({ 
        success: false, 
        message: `FaucetPay OK, mas SEOFast falhou: ${sfResult.message}`,
        account: { ...accountRecord, seofastUsername: sfResult.username, seofastStatus: "falhou" }
      });
    }
  } else {
    emit.result({
      success: true,
      message: activated ? "Conta FaucetPay criada e ativada com sucesso!" : "Conta criada mas ativação pendente.",
      account: accountRecord,
    });
  }
}

// ============================================================
// LOGIN FAUCETPAY (email + senha + anti-bot + 2FA)
// ============================================================

export interface LoginData {
  email: string;
  password: string;
  /** Optional: provide a 2FA EMAIL_OTP code manually (skips IMAP read). */
  twoFaCode?: string;
}

export interface LoginResult {
  success: boolean;
  message: string;
  token?: string;
  etag?: string;
  /** True when the session is fully authorized (no pending 2FA). */
  authorized?: boolean;
  /** Present when the account requires a 2FA step that wasn't completed. */
  twoFaRequired?: boolean;
  twoFaType?: string;
  /** Session cookies captured from the login response (Cookie header value). */
  cookies?: string;
  /** Parsed user information when fully authorized. */
  user?: any;
}

/**
 * Merge Set-Cookie headers from a response into a simple cookie jar object.
 * Node's fetch exposes multiple Set-Cookie via getSetCookie() (undici).
 */
export function mergeSetCookies(jar: Record<string, string>, resp: Response): void {
  let setCookies: string[] = [];
  const anyHeaders = resp.headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    setCookies = anyHeaders.getSetCookie();
  } else {
    const raw = resp.headers.get("set-cookie");
    if (raw) setCookies = [raw];
  }
  for (const sc of setCookies) {
    const pair = sc.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name) jar[name] = value;
    }
  }
}

export function jarToHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Generate the digital keys used by the login/register requests (testable). */
export function generateDigitalKeys(email: string): { xDigitalKey: string; yDigitalKey: string } {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let xDigitalKey = "";
  for (let i = 0; i < 16; i++) {
    xDigitalKey += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const yDigitalKey = crypto
    .createHash("md5")
    .update(`${email}${Date.now() / 1000}${Math.random()}`)
    .digest("hex");
  return { xDigitalKey, yDigitalKey };
}

/** Build the exact /account/login payload (testable). */
export function buildLoginPayload(
  data: { email: string; password: string },
  captchaResponse: string,
  keys: { xDigitalKey: string; yDigitalKey: string },
): Record<string, string> {
  return {
    user_email: data.email,
    password: data.password,
    captcha_response: captchaResponse,
    x_digital_key: keys.xDigitalKey,
    y_digital_key: keys.yDigitalKey,
  };
}

/**
 * Extract a numeric 2FA / OTP code (4-8 digits) from an email body.
 */
export function extractOtpCode(body: string): string | null {
  if (!body) return null;
  // Prefer codes near keywords like "code", "verification", "2fa"
  const keyword = body.match(/(?:code|c\u00f3digo|verification|verifica\u00e7\u00e3o|2fa|otp)[^0-9]{0,40}(\d{4,8})/i);
  if (keyword) return keyword[1];
  // Fallback: a standalone 6-digit block (most common OTP length)
  const six = body.match(/\b(\d{6})\b/);
  if (six) return six[1];
  const generic = body.match(/\b(\d{4,8})\b/);
  return generic ? generic[1] : null;
}

/**
 * Search a mailbox for a FaucetPay 2FA email and return the OTP code.
 */
async function searchMailboxForOtp(
  client: InstanceType<typeof ImapFlow>,
  mailbox: string,
  emit: EmitFn
): Promise<string | null> {
  let lock;
  try {
    lock = await client.getMailboxLock(mailbox);
  } catch {
    return null;
  }
  try {
    const searchQueries = [
      { seen: false, from: "faucetpay" },
      { seen: false, subject: "code" },
      { seen: false, subject: "2fa" },
      { from: "faucetpay" },
      { subject: "code" },
    ];
    const msgList: { source: any }[] = [];
    for (const query of searchQueries) {
      if (msgList.length > 0) break;
      try {
        const messages = client.fetch(query as any, { source: true });
        for await (const msg of messages) {
          if (msg.source) msgList.push({ source: msg.source });
        }
      } catch {
        // try next query
      }
    }
    const toCheck = msgList.slice(-5).reverse();
    for (const msg of toCheck) {
      const parsed: ParsedMail = await simpleParser(msg.source);
      const fromAddr = (parsed.from?.text || "").toLowerCase();
      const subject = (parsed.subject || "").toLowerCase();
      if (fromAddr.includes("faucetpay") || subject.includes("code") || subject.includes("2fa") || subject.includes("verification")) {
        const text = (parsed.text || parsed.html || parsed.textAsHtml || "") as string;
        const code = extractOtpCode(text);
        if (code) {
          emit.log(`\u2192 C\u00f3digo 2FA encontrado: ${code}`, "success");
          return code;
        }
      }
    }
  } finally {
    try { lock.release(); } catch {}
  }
  return null;
}

/**
 * Wait for the FaucetPay 2FA email and return the OTP code.
 */
async function waitForOtpCode(
  emit: EmitFn,
  config: Record<string, string>,
  maxWait = 120,
  checkInterval = 10
): Promise<string | null> {
  const loginEmail = config.gmail_login_email;
  const appPassword = config.gmail_app_password;
  if (!loginEmail || !appPassword) {
    emit.log("Credenciais Gmail n\u00e3o configuradas para ler o c\u00f3digo 2FA!", "error");
    return null;
  }
  emit.log("Aguardando email com c\u00f3digo 2FA...", "info");
  await sleep(8000);
  const startTime = Date.now();
  const mailboxes = ["INBOX", "[Gmail]/Spam", "[Gmail]/Lixo eletr\u00f4nico", "Junk"];
  while (Date.now() - startTime < maxWait * 1000) {
    try {
      const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: loginEmail, pass: appPassword },
        logger: false as any,
      });
      await client.connect();
      let code: string | null = null;
      for (const mailbox of mailboxes) {
        code = await searchMailboxForOtp(client, mailbox, emit);
        if (code) break;
      }
      await client.logout();
      if (code) return code;
    } catch (e: any) {
      emit.log(`Erro IMAP (2FA): ${e.message?.slice(0, 80)}`, "warn");
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    emit.log(`Aguardando c\u00f3digo 2FA... (${elapsed}s/${maxWait}s)`, "info");
    await sleep(checkInterval * 1000);
  }
  emit.log(`Timeout! C\u00f3digo 2FA n\u00e3o chegou em ${maxWait}s.`, "error");
  return null;
}

/**
 * Log into FaucetPay using email + password, solving the basilisk anti-bot
 * challenge. Mirrors the exact request flow observed on faucetpay.io:
 *   1) solve captcha (basilisk)
 *   2) POST /account/login  -> { success, token, tfa_authorized, etag }
 *   3) if 2FA (EMAIL_OTP): GET /account/get-2fa-type, POST /account/resend-2fa-code,
 *      read OTP via IMAP (or use provided code), POST /account/verify-2fa
 *   4) POST /account/get-user-information (authorized only)
 */
export async function loginFaucetPay(data: LoginData, emit: EmitFn, browserHeaders?: BrowserHeaders): Promise<LoginResult> {
  // Seta os headers do navegador real para uso em todas as requisições deste ciclo
  _activeBrowserHeaders = browserHeaders;
  if (browserHeaders) {
    emit.log(`[Headers] UA: ${browserHeaders["user-agent"]?.slice(0, 60)}... | Lang: ${browserHeaders["accept-language"]?.slice(0, 20)}`, "info");
  }

  const config = await getConfig();
  const jar: Record<string, string> = {};

  emit.status("captcha", "running");
  emit.log(`Iniciando login: ${data.email}`, "info");

  // ─── 1) RESOLVER CAPTCHA ───
  emit.log("[1/3] Resolvendo captcha...", "info");
  const captchaResponse = await solveCaptcha(emit, config);
  if (!captchaResponse) {
    emit.status("captcha", "failed");
    const r: LoginResult = { success: false, message: "N\u00e3o foi poss\u00edvel resolver o captcha." };
    emit.result(r);
    return r;
  }
  emit.status("captcha", "done");

  // ─── 2) LOGIN ───
  emit.status("register", "running");
  emit.log("[2/3] Autenticando em faucetpay.io...", "info");

  // Generate digital keys + payload exactly like the register flow.
  const keys = generateDigitalKeys(data.email);
  const loginPayload = buildLoginPayload(data, captchaResponse, keys);

  let token: string | undefined;
  let etag: string | undefined;
  let tfaAuthorized = 0;
  try {
    await sleep(500 + Math.random() * 1000);
    const resp = await fetch(`${API_URL}/account/login`, {
      method: "POST",
      headers: HEADERS_API,
      body: JSON.stringify(loginPayload),
    });
    mergeSetCookies(jar, resp);
    const result = (await resp.json()) as any;
    if (!result.success) {
      emit.status("register", "failed");
      emit.log(`Login falhou: ${result.message || JSON.stringify(result)}`, "error");
      const r: LoginResult = { success: false, message: result.message || "Credenciais inv\u00e1lidas" };
      emit.result(r);
      return r;
    }
    token = result.token;
    etag = result.etag;
    tfaAuthorized = Number(result.tfa_authorized ?? 0);
    if (token) jar["token"] = token;
    emit.log(`\u2713 Login aceito. ${result.message || ""}`, "success");
  } catch (e: any) {
    emit.status("register", "failed");
    const r: LoginResult = { success: false, message: `Erro: ${e.message}` };
    emit.result(r);
    return r;
  }
  emit.status("register", "done");

  const baseAuthHeaders: Record<string, string> = {
    ...HEADERS_API,
    "sec-fetch-site": "same-site",
    cookie: jarToHeader(jar),
  };

  // ─── 3) 2FA (EMAIL_OTP) ───
  if (tfaAuthorized === 0) {
    emit.status("activate", "running");
    emit.log("[3/3] Verifica\u00e7\u00e3o 2FA necess\u00e1ria...", "info");
    let twoFaType = "";
    try {
      const typeResp = await fetch(`${API_URL}/account/get-2fa-type`, {
        method: "GET",
        headers: baseAuthHeaders,
      });
      mergeSetCookies(jar, typeResp);
      const typeData = (await typeResp.json()) as any;
      twoFaType = typeData.tfa_type || "";
      emit.log(`Tipo de 2FA: ${twoFaType || "desconhecido"}`, "info");
    } catch (e: any) {
      emit.log(`N\u00e3o foi poss\u00edvel obter tipo de 2FA: ${e.message?.slice(0, 80)}`, "warn");
    }

    // Obtain the OTP code: prefer manually provided, else read via IMAP.
    let code = data.twoFaCode || null;
    if (!code && twoFaType.toUpperCase().includes("EMAIL")) {
      try {
        await fetch(`${API_URL}/account/resend-2fa-code`, {
          method: "POST",
          headers: { ...baseAuthHeaders, "content-length": "0" },
        });
        emit.log("C\u00f3digo 2FA solicitado por email.", "info");
      } catch (e: any) {
        emit.log(`Falha ao solicitar c\u00f3digo 2FA: ${e.message?.slice(0, 80)}`, "warn");
      }
      code = await waitForOtpCode(emit, config);
    }

    if (!code) {
      emit.status("activate", "failed");
      const r: LoginResult = {
        success: false,
        message: "2FA necess\u00e1rio: informe o c\u00f3digo (twoFaCode) ou configure o IMAP para leitura autom\u00e1tica.",
        token,
        etag,
        authorized: false,
        twoFaRequired: true,
        twoFaType,
        cookies: jarToHeader(jar),
      };
      emit.result(r);
      return r;
    }

    try {
      const verifyResp = await fetch(`${API_URL}/account/verify-2fa`, {
        method: "POST",
        headers: baseAuthHeaders,
        body: JSON.stringify({ code }),
      });
      mergeSetCookies(jar, verifyResp);
      const verifyData = (await verifyResp.json()) as any;
      if (!verifyData.success) {
        emit.status("activate", "failed");
        const r: LoginResult = {
          success: false,
          message: verifyData.message || "C\u00f3digo 2FA inv\u00e1lido",
          token,
          etag,
          authorized: false,
          twoFaRequired: true,
          twoFaType,
          cookies: jarToHeader(jar),
        };
        emit.result(r);
        return r;
      }
      if (verifyData.token) {
        token = verifyData.token;
        jar["token"] = token!;
      }
      tfaAuthorized = 1;
      emit.log("2FA verificado com sucesso!", "success");
    } catch (e: any) {
      emit.status("activate", "failed");
      const r: LoginResult = { success: false, message: `Erro ao verificar 2FA: ${e.message}`, token, etag, cookies: jarToHeader(jar) };
      emit.result(r);
      return r;
    }
    emit.status("activate", "done");
  }

  // ─── 4) USER INFO (sess\u00e3o autorizada) ───
  let user: any = undefined;
  try {
    const infoResp = await fetch(`${API_URL}/account/get-user-information`, {
      method: "POST",
      headers: { ...HEADERS_API, "sec-fetch-site": "same-site", "content-length": "0", cookie: jarToHeader(jar) },
    });
    mergeSetCookies(jar, infoResp);
    const infoData = (await infoResp.json()) as any;
    if (infoData.success) {
      user = infoData.data ?? infoData;
      emit.log("Informa\u00e7\u00f5es da conta obtidas.", "success");
    } else {
      emit.log(`get-user-information: ${infoData.message || "sem dados"}`, "warn");
    }
  } catch (e: any) {
    emit.log(`Falha ao obter informa\u00e7\u00f5es da conta: ${e.message?.slice(0, 80)}`, "warn");
  }

  const r: LoginResult = {
    success: true,
    message: "Login realizado com sucesso.",
    token,
    etag,
    authorized: tfaAuthorized === 1,
    twoFaRequired: false,
    cookies: jarToHeader(jar),
    user,
  };
  emit.result(r);
  return r;
}

// ============================================================
// UTILS
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

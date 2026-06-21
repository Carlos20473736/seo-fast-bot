/**
 * Header Randomizer para SEOFast Registration
 * 
 * Gera headers realistas apenas para Firefox/Android
 * Accept-Language é determinado pelo IP (código de país)
 */

// ============================================================
// FIREFOX ANDROID USER AGENTS (RANDOMIZADOS)
// ============================================================

const FIREFOX_VERSIONS = [148, 149, 150, 151, 152, 153];
const ANDROID_VERSIONS = [11, 12, 13, 14];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFirefoxUA(): string {
  const ffVer = randomChoice(FIREFOX_VERSIONS);
  const androidVer = randomChoice(ANDROID_VERSIONS);
  return `Mozilla/5.0 (Android ${androidVer}; Mobile; rv:${ffVer}.0) Gecko/${ffVer}.0 Firefox/${ffVer}.0`;
}

// ============================================================
// MAPEAMENTO DE IDIOMA POR PAÍS (BASEADO EM IP)
// ============================================================

const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  // América
  "BR": "pt-BR",
  "PT": "pt-PT",
  "US": "en-US",
  "GB": "en-GB",
  "CA": "en-CA",
  "MX": "es-MX",
  "AR": "es-AR",
  "CL": "es-CL",
  "CO": "es-CO",
  "PE": "es-PE",
  "VE": "es-VE",

  // Europa
  "ES": "es-ES",
  "FR": "fr-FR",
  "DE": "de-DE",
  "IT": "it-IT",
  "RU": "ru-RU",
  "PL": "pl-PL",
  "NL": "nl-NL",
  "UA": "uk-UA",
  "RO": "ro-RO",
  "CZ": "cs-CZ",
  "SE": "sv-SE",
  "NO": "nb-NO",
  "FI": "fi-FI",
  "DK": "da-DK",
  "BE": "nl-BE",
  "AT": "de-AT",
  "CH": "de-CH",
  "GR": "el-GR",
  "HU": "hu-HU",
  "BG": "bg-BG",
  "SK": "sk-SK",
  "HR": "hr-HR",
  "LT": "lt-LT",
  "LV": "lv-LV",
  "EE": "et-EE",
  "SI": "sl-SI",

  // Ásia
  "JP": "ja-JP",
  "CN": "zh-CN",
  "KR": "ko-KR",
  "IN": "hi-IN",
  "TH": "th-TH",
  "VN": "vi-VN",
  "ID": "id-ID",
  "PH": "fil-PH",
  "MY": "ms-MY",
  "TR": "tr-TR",

  // Oriente Médio
  "SA": "ar-SA",
  "AE": "ar-AE",
  "IL": "he-IL",

  // CIS
  "KZ": "kk-KZ",
  "UZ": "uz-UZ",
  "GE": "ka-GE",
  "AM": "hy-AM",
  "AZ": "az-AZ",
  "BY": "be-BY",
  "TJ": "tg-TJ",
};

function getLanguageByCountry(countryCode: string): string {
  return COUNTRY_TO_LANGUAGE[countryCode.toUpperCase()] || "en-US";
}

// ============================================================
// HELPERS
// ============================================================

function generateRandomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generatePHPSESSID(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const len = 26 + Math.floor(Math.random() * 4); // 26-29 chars
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateEntrance(): string {
  return generateRandomHex(32);
}

// ============================================================
// MAIN HEADER GENERATOR - FIREFOX/ANDROID ONLY
// ============================================================

export interface RandomizedHeaders {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  userAgent: string;
}

/**
 * Gera headers Firefox/Android com Accept-Language baseado no código de país
 * @param countryCode - Código de país (ex: "BR", "US", "RU")
 */
export function generateHeaders(countryCode: string): RandomizedHeaders {
  const userAgent = generateFirefoxUA();
  const acceptLanguage = getLanguageByCountry(countryCode);

  const headers: Record<string, string> = {
    "user-agent": userAgent,
    "accept": "*/*",
    "accept-language": acceptLanguage,
    "accept-encoding": "gzip, deflate, br, zstd",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
    "origin": "https://seo-fast.ru",
    "referer": "https://seo-fast.ru/register",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "priority": "u=0",
    "te": "trailers",
  };

  const cookies: Record<string, string> = {
    "PHPSESSID": generatePHPSESSID(),
    "entrance": generateEntrance(),
    "info_mobail": "true",
  };

  return { headers, cookies, userAgent };
}

// ============================================================
// MERGE HEADERS COM COOKIES
// ============================================================

export function mergeHeadersWithCookies(
  headers: Record<string, string>,
  cookies: Record<string, string>
): Record<string, string> {
  const merged = { ...headers };
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
  if (cookieHeader) {
    merged["cookie"] = cookieHeader;
  }
  return merged;
}

// ============================================================
// FUNÇÕES DE CONVENIÊNCIA
// ============================================================

/**
 * Headers completos para registro (com cookies embutidos)
 */
export function getRegistrationHeaders(countryCode: string = "US"): Record<string, string> {
  const { headers, cookies } = generateHeaders(countryCode);
  return mergeHeadersWithCookies(headers, cookies);
}

/**
 * Apenas headers (sem cookies - para uso com HttpClient que gerencia cookies)
 */
export function getHeadersOnly(countryCode: string = "US"): Record<string, string> {
  const { headers } = generateHeaders(countryCode);
  return headers;
}

/**
 * Apenas cookies
 */
export function getCookiesOnly(): Record<string, string> {
  return {
    "PHPSESSID": generatePHPSESSID(),
    "entrance": generateEntrance(),
    "info_mobail": "true",
  };
}

# Análise de Headers - SEO-FAST.RU

## Headers do Navegador para Qualificação de Novo Usuário

### 1. LOGIN (POST /ajax/ajax_login.php)

```
POST /ajax/ajax_login.php HTTP/1.1
Host: seo-fast.ru
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36
Accept: */*
Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7
Accept-Encoding: gzip, deflate, br, zstd
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Origin: https://seo-fast.ru
Referer: https://seo-fast.ru/
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: same-origin
X-Requested-With: XMLHttpRequest
DNT: 1
Sec-CH-UA: "Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Windows"
Priority: u=1, i
```

**Body:**
```
sf=70FA1546C2968BBCBBD0BEDC1DD531D7&logusername=sofia.silva@educatyui.space&logpassword=7fe1f8abaa&entrance_session=null&capcha_mat=&info_monitor=1920|1040|1920|1080|32|32&cashe_pl=PDF Viewer|undefinedChrome PDF Viewer|undefinedChromium PDF Viewer|undefinedMicrosoft Edge PDF Viewer|undefinedWebKit built-in PDF|undefined&video_gpu=ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)&c_choice=2&captcha=undefined
```

---

### 2. PAYMENT_USER (GET /payment_user)

**Primeira requisição (após login):**
```
GET /payment_user HTTP/1.1
Host: seo-fast.ru
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7
Accept-Encoding: gzip, deflate, br, zstd
Cache-Control: max-age=0
Upgrade-Insecure-Requests: 1
Sec-Fetch-Dest: document
Sec-Fetch-Mode: navigate
Sec-Fetch-Site: same-origin
Sec-Fetch-User: ?1
DNT: 1
Sec-CH-UA: "Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Windows"
Priority: u=0, i
```

---

## Diferenças Importantes

### Headers que o código atual está usando (ERRADO):

```typescript
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
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
  };
}
```

### Headers que deveriam ser usados para /payment_user (CORRETO):

```typescript
function desktopPageHeaders(): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "max-age=0",
    "upgrade-insecure-requests": "1",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "dnt": "1",
    "priority": "u=0, i",
  };
}
```

---

## Resumo das Mudanças Necessárias

1. **Para requisições de página HTML** (`/payment_user`, `/mystat`):
   - Usar `accept` com tipos HTML completos
   - Usar `sec-fetch-dest: document`
   - Usar `sec-fetch-mode: navigate`
   - Usar `upgrade-insecure-requests: 1`
   - Adicionar `cache-control: max-age=0`
   - Adicionar `dnt: 1`
   - Adicionar `priority: u=0, i`

2. **Para requisições AJAX** (`/ajax/ajax_login.php`):
   - Usar `accept: */*`
   - Usar `content-type: application/x-www-form-urlencoded; charset=UTF-8`
   - Usar `sec-fetch-dest: empty`
   - Usar `sec-fetch-mode: cors`
   - Usar `x-requested-with: XMLHttpRequest`
   - Usar `priority: u=1, i`

3. **Cookies importantes:**
   - `PHPSESSID` - mantém a sessão
   - `entrance` - token de entrada
   - Ambos devem ser preservados entre requisições

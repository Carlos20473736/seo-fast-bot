# FaucetPay Panel — TODO

## Migração e Configuração
- [x] Extrair arquivos do ZIP para o projeto inicializado
- [x] Restaurar arquivos sobrescritos pelo template (schema.ts, routers.ts, App.tsx, index.css, sonner.tsx, server/_core/index.ts)
- [x] Instalar dependências do engine (imapflow, mailparser, socket.io, socket.io-client, tough-cookie, openai, sharp)
- [x] Instalar @types/mailparser
- [x] Corrigir estrutura aninhada drizzle/meta/meta

## Banco de Dados
- [x] Aplicar schema users
- [x] Aplicar schema accounts (com campos SEOFast)
- [x] Aplicar schema app_config
- [x] Aplicar schema account_progress

## Painel (frontend)
- [x] Aba Criar Conta (CreateAccountTab)
- [x] Aba Saque (WithdrawalTab)
- [x] Aba Histórico (HistoryTab)
- [x] Aba Configurações (SettingsTab)
- [x] Barra de status (StatusBar) com indicador Online
- [x] Painel de logs em tempo real (LogPanel via Socket.IO)

## Engine (backend)
- [x] Integração do engine FaucetPay (engine.ts)
- [x] Integração SeoFast (seofast.ts, seofast-session.ts, seofast-withdraw.ts)
- [x] Registro do Socket.IO no servidor (registerSocketIO)
- [x] Routers tRPC (accounts, progress, config)

## Qualidade
- [x] Typecheck (tsc --noEmit) sem erros
- [x] Testes (vitest) — 5 testes passando
- [x] Build de produção (vite + esbuild) sem erros

## Publicação
- [x] Criar checkpoint
- [~] Publicar no domínio Manus (requer clique no botão Publish na interface — ação do usuário)

## Observações
- Runtime de deploy é Node-only (Autoscale/serverless). O arquivo `captcha_solver.py` (Python) não roda no runtime de produção; automações de longa duração e resolução de captcha em Python podem não funcionar de forma confiável no Autoscale.

## Correção: pergunta anti-bot no saque (SeoFast)
- [x] Melhorar extração do enunciado da pergunta anti-bot (não capturar JavaScript)
- [x] Resolver a pergunta de forma inteligente via LLM (entende russo) em vez de escolher options[0]
- [x] Manter fallback seguro caso o LLM falhe
- [x] Aplicar a correção em seofast-session.ts (fluxo ativo) e seofast-withdraw.ts
- [x] Validar typecheck e testes após a correção (8 testes passando)

## Reforço: fallback seguro anti-bot
- [x] Abortar saque (erro explícito) quando o LLM não resolver a pergunta, em vez de usar options[0]
- [x] Resposta do LLM por índice numérico (mais robusta) com reforço por texto
- [x] Adicionar teste cobrindo a extração (placeholder → null aciona fallback) e pergunta em russo (10 testes passando)

## Correção: l_entrance não encontrado no login (SeoFast)
- [x] Extração robusta do token l_entrance (cadeia de padrões: $.trim, aspas, input sf/l_entrance, fallback)
- [x] Retry no GET da página de login (página de verificação de dispositivo na 1ª visita)
- [x] Diagnóstico melhorado (loga trecho contendo l_entrance)
- [x] Teste cobrindo múltiplos formatos do token (16 testes passando)


## Login FaucetPay (email + senha + anti-bot)
- [x] Implementar loginFaucetPay no engine reaproveitando solveCaptcha
- [x] POST /account/login com {user_email, password, captcha_response, x_digital_key, y_digital_key}
- [x] Manter sessão via cookies (cookie jar) para chamadas pós-login
- [x] Tratar 2FA EMAIL_OTP: get-2fa-type, resend-2fa-code, verify-2fa
- [x] Expor handler Socket.IO (faucetpay_login) e integrar a aba Login no painel
- [x] Testes do login: extrator de OTP, payload de /account/login, chaves digitais e cookie jar (login.test.ts)
- [x] Validar typecheck + testes + build (29 testes passando)


## Correção: captcha sem Python (runtime Node-only)
- [x] Diagnosticar a falha "Command failed: python3 ... captcha_solver.py" (Python indisponível no runtime de deploy)
- [x] Portar a detecção de slide (cv2.matchTemplate / TM_CCORR_NORMED + máscara) para Node com sharp
- [x] Portar a detecção de ícones neon (HSV inRange + dilate/erode + contornos + crop) para Node com sharp
- [x] Substituir as chamadas a python3/execFile no engine pelas funções Node (captcha-cv.ts)
- [x] Validar equivalência Node vs OpenCV (slide x=210 conf=1.0; centros dos ícones idênticos)
- [x] Adicionar testes (captcha-cv.test.ts) — 24 testes passando
- [x] Remover captcha_solver.py e artefatos de teste; build de produção OK


## Calibração: detectSlidePositionCV fiel ao OpenCV (slide do login)
- [ ] Replicar matchTemplate 2D (varredura X e Y), não apenas y=0
- [ ] Usar a fórmula exata do TM_CCORR_NORMED com máscara (normalização por janela)
- [ ] Validar precisão contra OpenCV (mesmo X/confiança em imagens de teste)
- [ ] Rodar typecheck + testes + build

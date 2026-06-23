/**
 * Socket.IO handler for FaucetPay account creation, SEOFast sessions, and withdrawals
 * 
 * browserHeaders: headers reais capturados do navegador do usuário são passados
 * em todos os eventos e propagados para engine/seofast para uso nas requisições.
 */

import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAccountProcess, reactivateAccount, loginFaucetPay, getConfig, type AccountData, type EmitFn } from "./engine";
import { resolveProxyConfig, createProxyHttpsAgent, proxyLabel } from "./proxy";
import {
  loginSession,
  refreshBalance,
  checkWithdrawal,
  requestApproval,
  executeWithdrawal,
  getSessionInfo,
  getAllSessions,
  disconnectSession,
  disconnectAllSessions,
} from "./seofast-session";

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

export function registerSocketIO(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/api/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);
    socket.emit("connected", { msg: "Conectado ao servidor" });

    // ============================================================
    // ACCOUNT CREATION
    // ============================================================

    socket.on("create_account", (data: AccountData & { browserHeaders?: BrowserHeaders }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      const browserHeaders = data.browserHeaders;
      // Remove browserHeaders do data antes de passar para o engine
      const accountData: AccountData = {
        username: data.username,
        email: data.email,
        password: data.password,
        referrer: data.referrer,
        createSeofast: data.existingAccount ? true : data.createSeofast,
        existingAccount: data.existingAccount,
      };

      createAccountProcess(accountData, emit, browserHeaders).catch((err) => {
        emit.log(`Erro fatal: ${err.message}`, "error");
        emit.result({ success: false, message: `Erro interno: ${err.message}` });
      });
    });

    socket.on("reactivate_account", (data: { email: string; browserHeaders?: BrowserHeaders }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      reactivateAccount(data.email, emit).catch((err) => {
        emit.log(`Erro fatal: ${err.message}`, "error");
        emit.result({ success: false, message: `Erro interno: ${err.message}` });
      });
    });

    // ============================================================
    // FAUCETPAY LOGIN (email + senha + anti-bot + 2FA)
    // ============================================================

    /**
     * Log into FaucetPay with email + password, solving the basilisk anti-bot.
     * Input: { email: string, password: string, twoFaCode?: string, browserHeaders }
     * Emits: "faucetpay_login_result" with LoginResult
     */
    socket.on("faucetpay_login", (data: { email: string; password: string; twoFaCode?: string; browserHeaders?: BrowserHeaders }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      loginFaucetPay({ email: data.email, password: data.password, twoFaCode: data.twoFaCode }, emit, data.browserHeaders)
        .then((result) => socket.emit("faucetpay_login_result", result))
        .catch((err) => {
          emit.log(`Erro fatal: ${err.message}`, "error");
          socket.emit("faucetpay_login_result", { success: false, message: `Erro interno: ${err.message}` });
        });
    });

    // ============================================================
    // SEOFAST SESSION MANAGEMENT
    // ============================================================

    /**
     * Login to SEOFast account and create persistent session
     * Input: { email: string, password: string, browserHeaders }
     * Emits: "session_update" with SessionInfo
     */
    socket.on("seofast_login", async (data: { email: string; password: string; browserHeaders?: BrowserHeaders }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      try {
        const config = await getConfig();
        const proxyCfg = resolveProxyConfig(config);
        const proxyAgent = createProxyHttpsAgent(proxyCfg, data.email, { minVersion: "TLSv1.2", maxVersion: "TLSv1.2", ciphers: "DEFAULT@SECLEVEL=1" });
        emit.log(`Proxy: ${proxyLabel(proxyCfg, data.email)}`, "info");
        const result = await loginSession(data.email, data.password, emit, proxyAgent, data.browserHeaders);
        socket.emit("session_update", result);
      } catch (err: any) {
        emit.log(`Erro no login: ${err.message}`, "error");
        socket.emit("session_update", {
          email: data.email,
          status: "error",
          balance: "0",
          loginTime: 0,
          lastActivity: 0,
          message: err.message,
        });
      }
    });

    /**
     * Refresh balance for an existing session
     * Input: { email: string }
     * Emits: "balance_update" with { email, balance, success }
     */
    socket.on("seofast_refresh_balance", async (data: { email: string }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      try {
        const result = await refreshBalance(data.email, emit);
        socket.emit("balance_update", { email: data.email, ...result });
      } catch (err: any) {
        socket.emit("balance_update", { email: data.email, balance: "0", success: false });
      }
    });

    /**
     * Check withdrawal availability using session
     * Input: { email: string, password: string }
     * Emits: "withdrawal_status" with WithdrawalCheckResult
     */
    socket.on("check_withdrawal_status", async (data: { email: string; password: string }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      try {
        const result = await checkWithdrawal(data.email, data.password, emit);
        socket.emit("withdrawal_status", { email: data.email, ...result });
      } catch (err: any) {
        emit.log(`Erro ao verificar: ${err.message}`, "error");
        socket.emit("withdrawal_status", {
          email: data.email,
          status: "unknown",
          balance: "0",
          message: err.message,
        });
      }
    });

    /**
     * Request withdrawal approval (test_acc_pay)
     * Input: { email: string, password: string }
     * Emits: "approval_result"
     */
    socket.on("seofast_request_approval", async (data: { email: string; password: string }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      try {
        const result = await requestApproval(data.email, data.password, emit);
        socket.emit("approval_result", { email: data.email, ...result });
      } catch (err: any) {
        emit.log(`Erro: ${err.message}`, "error");
        socket.emit("approval_result", { email: data.email, success: false, status: "error", message: err.message });
      }
    });

    /**
     * Execute withdrawal (full flow: login → check → approve → submit)
     * Input: { email: string, password: string, amount: number, browserHeaders }
     * Emits: "withdrawal_result"
     */
    socket.on("request_withdrawal", async (data: { email: string; password: string; amount?: number; browserHeaders?: BrowserHeaders }) => {
      const emit: EmitFn = {
        log: (msg, type) => socket.emit("log", { msg, type }),
        status: (step, status) => socket.emit("status", { step, status }),
        result: (resultData) => socket.emit("result", resultData),
      };

      emit.status("captcha", "running");

      try {
        const result = await executeWithdrawal(data.email, data.password, data.amount || 30, emit, data.browserHeaders);

        if (result.success) {
          emit.status("captcha", "done");
          emit.status("register", "done");
          emit.status("activate", "done");
          emit.status("seofast_wallet", "done");
        } else {
          emit.status("captcha", "done");
          emit.status("register", "failed");
        }

        emit.result({
          success: result.success,
          message: result.message,
          account: { balance: result.balance, approvalStatus: result.success ? "approved" : "failed" },
        });
      } catch (err: any) {
        emit.log(`Erro fatal: ${err.message}`, "error");
        emit.status("captcha", "failed");
        emit.result({ success: false, message: `Erro interno: ${err.message}` });
      }
    });

    /**
     * Get session info for a specific account
     * Input: { email: string }
     * Emits: "session_info"
     */
    socket.on("get_session_info", (data: { email: string }) => {
      const info = getSessionInfo(data.email);
      socket.emit("session_info", { email: data.email, session: info });
    });

    /**
     * Get all active sessions
     * Emits: "all_sessions"
     */
    socket.on("get_all_sessions", () => {
      const sessions = getAllSessions();
      socket.emit("all_sessions", sessions);
    });

    /**
     * Disconnect a specific session
     * Input: { email: string }
     */
    socket.on("seofast_disconnect", (data: { email: string }) => {
      disconnectSession(data.email);
      socket.emit("session_update", {
        email: data.email,
        status: "disconnected",
        balance: "0",
        loginTime: 0,
        lastActivity: 0,
      });
    });

    /**
     * Disconnect all sessions
     */
    socket.on("seofast_disconnect_all", () => {
      disconnectAllSessions();
      socket.emit("all_sessions", []);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

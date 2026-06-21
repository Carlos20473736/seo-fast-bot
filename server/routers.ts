import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { accounts, appConfig, accountProgress } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getConfig, setConfig, testImapConnection } from "./faucetpay/engine";
import crypto from "crypto";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  accounts: router({
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(accounts).orderBy(desc(accounts.createdAt));
      return rows;
    }),
  }),

  // ============================================================
  // PROGRESS - Persistência de estado de criação de conta
  // ============================================================
  progress: router({
    /**
     * Busca o progresso atual (se existir) para retomar
     */
    get: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const rows = await db
          .select()
          .from(accountProgress)
          .where(eq(accountProgress.sessionId, input.sessionId))
          .limit(1);
        return rows[0] || null;
      }),

    /**
     * Busca o último progresso ativo (não completado/falhou)
     */
    getActive: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select()
        .from(accountProgress)
        .where(eq(accountProgress.currentStep, "captcha_pending"))
        .orderBy(desc(accountProgress.createdAt))
        .limit(1);
      
      // Buscar qualquer progresso que não esteja completo ou falhou
      if (rows[0]) return rows[0];
      
      const allActive = await db
        .select()
        .from(accountProgress)
        .orderBy(desc(accountProgress.updatedAt))
        .limit(1);
      
      const active = allActive[0];
      if (active && active.currentStep !== "completed" && active.currentStep !== "failed") {
        return active;
      }
      return null;
    }),

    /**
     * Cria um novo progresso de criação de conta
     */
    create: publicProcedure
      .input(
        z.object({
          email: z.string(),
          password: z.string(),
          username: z.string().optional(),
          formData: z.string().optional(),
          ipAddress: z.string().optional(),
          countryCode: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;

        const sessionId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

        await db.insert(accountProgress).values({
          sessionId,
          email: input.email,
          password: input.password,
          username: input.username || null,
          currentStep: "captcha_pending",
          formData: input.formData || null,
          ipAddress: input.ipAddress || null,
          countryCode: input.countryCode || null,
        });

        return { sessionId };
      }),

    /**
     * Atualiza o progresso (etapa, cookies, tokens, erro, etc)
     */
    update: publicProcedure
      .input(
        z.object({
          sessionId: z.string(),
          currentStep: z
            .enum([
              "captcha_pending",
              "registration_pending",
              "registration_done",
              "verification_pending",
              "activation_pending",
              "wallet_pending",
              "completed",
              "failed",
            ])
            .optional(),
          formData: z.string().optional(),
          cookies: z.string().optional(),
          tokens: z.string().optional(),
          headersUsed: z.string().optional(),
          errorMessage: z.string().optional(),
          errorStep: z.string().optional(),
          accountId: z.number().optional(),
          username: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { success: false };

        const updateData: Record<string, any> = {};
        if (input.currentStep) updateData.currentStep = input.currentStep;
        if (input.formData) updateData.formData = input.formData;
        if (input.cookies) updateData.cookies = input.cookies;
        if (input.tokens) updateData.tokens = input.tokens;
        if (input.headersUsed) updateData.headersUsed = input.headersUsed;
        if (input.errorMessage !== undefined) updateData.errorMessage = input.errorMessage;
        if (input.errorStep) updateData.errorStep = input.errorStep;
        if (input.accountId) updateData.accountId = input.accountId;
        if (input.username) updateData.username = input.username;

        if (input.currentStep === "completed") {
          updateData.completedAt = new Date();
        }

        await db
          .update(accountProgress)
          .set(updateData)
          .where(eq(accountProgress.sessionId, input.sessionId));

        return { success: true };
      }),

    /**
     * Marca como falhou
     */
    fail: publicProcedure
      .input(
        z.object({
          sessionId: z.string(),
          errorMessage: z.string(),
          errorStep: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { success: false };

        await db
          .update(accountProgress)
          .set({
            currentStep: "failed",
            errorMessage: input.errorMessage,
            errorStep: input.errorStep,
          })
          .where(eq(accountProgress.sessionId, input.sessionId));

        return { success: true };
      }),

    /**
     * Limpa progresso antigo (completado ou falhou)
     */
    clear: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { success: false };

        await db
          .delete(accountProgress)
          .where(eq(accountProgress.sessionId, input.sessionId));

        return { success: true };
      }),

    /**
     * Lista todos os progressos (para debug)
     */
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(accountProgress).orderBy(desc(accountProgress.updatedAt));
    }),
  }),

  config: router({
    get: publicProcedure.query(async () => {
      const config = await getConfig();
      return {
        gmail_login_email: config.gmail_login_email || "",
        has_openai_key: !!config.openai_api_key,
        has_gmail_password: !!config.gmail_app_password,
        has_gmail_account_password: !!config.gmail_password,
        proxy_enabled: config.proxy_enabled || "1",
        proxy_host: config.proxy_host || "gw.dataimpulse.com",
        proxy_port: config.proxy_port || "823",
        proxy_username: config.proxy_username || "2967368d437d02bb56af",
        has_proxy_password: !!config.proxy_password,
      };
    }),
    update: publicProcedure
      .input(
        z.object({
          openai_api_key: z.string().optional(),
          gmail_app_password: z.string().optional(),
          gmail_login_email: z.string().optional(),
          gmail_password: z.string().optional(),
          proxy_enabled: z.string().optional(),
          proxy_host: z.string().optional(),
          proxy_port: z.string().optional(),
          proxy_username: z.string().optional(),
          proxy_password: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        if (input.openai_api_key) {
          await setConfig("openai_api_key", input.openai_api_key);
        }
        if (input.gmail_app_password) {
          await setConfig("gmail_app_password", input.gmail_app_password);
        }
        if (input.gmail_login_email) {
          await setConfig("gmail_login_email", input.gmail_login_email);
        }
        if (input.gmail_password) {
          await setConfig("gmail_password", input.gmail_password);
        }
        if (input.proxy_enabled !== undefined) {
          await setConfig("proxy_enabled", input.proxy_enabled);
        }
        if (input.proxy_host) {
          await setConfig("proxy_host", input.proxy_host);
        }
        if (input.proxy_port) {
          await setConfig("proxy_port", input.proxy_port);
        }
        if (input.proxy_username) {
          await setConfig("proxy_username", input.proxy_username);
        }
        if (input.proxy_password) {
          await setConfig("proxy_password", input.proxy_password);
        }
        return { success: true };
      }),
    testImap: publicProcedure
      .input(
        z.object({
          email: z.string().optional(),
          password: z.string().optional(),
        }).optional()
      )
      .mutation(async ({ input }) => {
      try {
        const config = await getConfig();
        const email = input?.email || config.gmail_login_email;
        const password = input?.password || config.gmail_app_password;

        if (!email || !password) {
          return {
            success: false,
            message: "Credenciais não configuradas",
            details: "Preencha o email e a senha de app (App Password) antes de testar.",
          };
        }

        return await testImapConnection(email, password);
      } catch (e: any) {
        return {
          success: false,
          message: "Falha ao testar conexão IMAP",
          details: (e?.message || "Erro desconhecido").slice(0, 200),
        };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;

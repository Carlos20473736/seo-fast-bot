import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("accounts.list", () => {
  it("returns an array (possibly empty)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.accounts.list();
    expect(Array.isArray(result)).toBe(true);
  }, 15000);
});

describe("config.get", () => {
  it("returns config shape with expected fields", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.config.get();
    expect(result).toHaveProperty("gmail_login_email");
    expect(result).toHaveProperty("has_openai_key");
    expect(result).toHaveProperty("has_gmail_password");
    expect(typeof result.gmail_login_email).toBe("string");
    expect(typeof result.has_openai_key).toBe("boolean");
    expect(typeof result.has_gmail_password).toBe("boolean");
  });
});

describe("config.update", () => {
  it("accepts config update and returns success", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.config.update({
      gmail_login_email: "test@example.com",
    });
    expect(result).toEqual({ success: true });
  });

  it("persists gmail_login_email after update", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await caller.config.update({
      gmail_login_email: "persisted@example.com",
    });

    const config = await caller.config.get();
    expect(config.gmail_login_email).toBe("persisted@example.com");
  });
});

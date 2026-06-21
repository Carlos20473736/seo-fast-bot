import { describe, expect, it } from "vitest";
import {
  extractOtpCode,
  buildLoginPayload,
  generateDigitalKeys,
  mergeSetCookies,
  jarToHeader,
} from "./engine";

describe("extractOtpCode", () => {
  it("extracts a 6-digit code near the word 'code'", () => {
    expect(extractOtpCode("Your verification code is 482913. It expires in 10 minutes.")).toBe("482913");
  });

  it("extracts a code from a Portuguese email", () => {
    expect(extractOtpCode("Seu código de verificação é 102938.")).toBe("102938");
  });

  it("extracts a standalone 6-digit block as fallback", () => {
    expect(extractOtpCode("FaucetPay\n\n  559213  \n\nDo not share this.")).toBe("559213");
  });

  it("handles 2FA keyword", () => {
    expect(extractOtpCode("2FA: 7788")).toBe("7788");
  });

  it("returns null when there is no numeric code", () => {
    expect(extractOtpCode("There is no code in this message.")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractOtpCode("")).toBeNull();
  });
});

describe("buildLoginPayload", () => {
  it("builds the exact /account/login payload shape", () => {
    const payload = buildLoginPayload(
      { email: "user@example.com", password: "secret123" },
      "CAPTCHA_TOKEN",
      { xDigitalKey: "XKEY", yDigitalKey: "YKEY" },
    );
    expect(payload).toEqual({
      user_email: "user@example.com",
      password: "secret123",
      captcha_response: "CAPTCHA_TOKEN",
      x_digital_key: "XKEY",
      y_digital_key: "YKEY",
    });
    // Ensure no extra keys leak into the request.
    expect(Object.keys(payload).sort()).toEqual(
      ["captcha_response", "password", "user_email", "x_digital_key", "y_digital_key"],
    );
  });
});

describe("generateDigitalKeys", () => {
  it("produces a 16-char x key and a 32-hex md5 y key", () => {
    const { xDigitalKey, yDigitalKey } = generateDigitalKeys("a@b.com");
    expect(xDigitalKey).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(yDigitalKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns different keys on each call (randomized)", () => {
    const a = generateDigitalKeys("a@b.com");
    const b = generateDigitalKeys("a@b.com");
    expect(a.xDigitalKey).not.toBe(b.xDigitalKey);
    expect(a.yDigitalKey).not.toBe(b.yDigitalKey);
  });
});

/** Minimal Response-like stub exposing getSetCookie (undici-style). */
function fakeResponse(setCookies: string[]): Response {
  return {
    headers: {
      getSetCookie: () => setCookies,
      get: (name: string) => (name.toLowerCase() === "set-cookie" ? setCookies[0] ?? null : null),
    },
  } as unknown as Response;
}

describe("cookie jar (session persistence)", () => {
  it("merges Set-Cookie headers into the jar and reuses them across calls", () => {
    const jar: Record<string, string> = {};
    // First response (login) sets the session cookie.
    mergeSetCookies(jar, fakeResponse(["PHPSESSID=abc123; Path=/; HttpOnly", "csrf=zzz; Path=/"]));
    expect(jar.PHPSESSID).toBe("abc123");
    expect(jar.csrf).toBe("zzz");

    // A subsequent response updates one cookie; old ones persist.
    mergeSetCookies(jar, fakeResponse(["PHPSESSID=def456; Path=/"]));
    expect(jar.PHPSESSID).toBe("def456");
    expect(jar.csrf).toBe("zzz");

    // The header sent on the next authenticated request includes all cookies.
    const header = jarToHeader(jar);
    expect(header).toContain("PHPSESSID=def456");
    expect(header).toContain("csrf=zzz");
  });

  it("falls back to the single set-cookie header when getSetCookie is absent", () => {
    const jar: Record<string, string> = {};
    const resp = {
      headers: { get: (n: string) => (n.toLowerCase() === "set-cookie" ? "token=tok999; Path=/" : null) },
    } as unknown as Response;
    mergeSetCookies(jar, resp);
    expect(jar.token).toBe("tok999");
  });
});

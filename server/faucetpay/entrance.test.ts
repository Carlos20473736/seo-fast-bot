import { describe, expect, it } from "vitest";
import { extractEntranceToken } from "./seofast-session";

/**
 * Valida a extração robusta do token l_entrance (parâmetro `sf` do login do
 * seo-fast.ru), que o site já entregou em formatos diferentes. A falha em
 * extrair esse token causava o erro "l_entrance não encontrado".
 */
describe("extractEntranceToken", () => {
  const HASH = "FE68D859DA32C5B1A0AA22EE1A172C25";

  it("extrai do formato clássico var l_entrance = $.trim('HASH')", () => {
    const html = `<script>var l_entrance = $.trim('${HASH}');</script>`;
    expect(extractEntranceToken(html)).toBe(HASH);
  });

  it("extrai de l_entrance = \"HASH\" (aspas duplas)", () => {
    const html = `<script>l_entrance = "${HASH}";</script>`;
    expect(extractEntranceToken(html)).toBe(HASH);
  });

  it("extrai de l_entrance = 'hash' (minúsculas)", () => {
    const lower = HASH.toLowerCase();
    const html = `var l_entrance='${lower}';`;
    expect(extractEntranceToken(html)).toBe(lower);
  });

  it("extrai de <input name=\"sf\" value=\"HASH\">", () => {
    const html = `<form><input type="hidden" name="sf" value="${HASH}"></form>`;
    expect(extractEntranceToken(html)).toBe(HASH);
  });

  it("extrai de <input name=\"l_entrance\" value=\"HASH\">", () => {
    const html = `<input name="l_entrance" value="${HASH}" />`;
    expect(extractEntranceToken(html)).toBe(HASH);
  });

  it("retorna null para página de verificação de dispositivo (sem token)", () => {
    const html = `<html><script>if (window.devicePixelRatio !== 1) { var dpt = window.devicePixelRatio; }</script></html>`;
    expect(extractEntranceToken(html)).toBeNull();
  });
});

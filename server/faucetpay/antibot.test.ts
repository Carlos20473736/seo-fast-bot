import { describe, expect, it } from "vitest";
import { extractAntiBotQuestion } from "./seofast-session";

/**
 * Valida a extração da pergunta anti-bot e das opções a partir do HTML real
 * exibido na página de pagamento do seo-fast.ru. Exemplo observado:
 * "Qual destes você pode comer?" → Machado, Cinco, Tijolo, Azul, Melancia
 */
describe("extractAntiBotQuestion", () => {
  const html = `
    <div class="payment_form">
      <script>var x = function(){ $('#pm_payment_id').html('teste'); }</script>
      <div class="q-bot">
        <label class="q-bot-title">Qual destes você pode comer?</label>
        <select id="select_q_bot_payment" name="select_q_bot_payment">
          <option value="0">Selecione uma opção de resposta</option>
          <option value="1">Machado</option>
          <option value="2">Cinco</option>
          <option value="3">Tijolo</option>
          <option value="4">Azul</option>
          <option value="5">Melancia</option>
        </select>
      </div>
    </div>
  `;

  it("extrai o enunciado correto (não captura JavaScript)", () => {
    const result = extractAntiBotQuestion(html);
    expect(result).not.toBeNull();
    expect(result!.question).toBe("Qual destes você pode comer?");
  });

  it("extrai todas as opções válidas e descarta o placeholder", () => {
    const result = extractAntiBotQuestion(html);
    expect(result).not.toBeNull();
    const texts = result!.options.map((o) => o.text);
    expect(texts).toEqual(["Machado", "Cinco", "Tijolo", "Azul", "Melancia"]);
    // O placeholder (value 0 / "Selecione uma opção") não deve aparecer.
    expect(texts).not.toContain("Selecione uma opção de resposta");
  });

  it("retorna null quando não há select de anti-bot", () => {
    expect(extractAntiBotQuestion("<div>sem select</div>")).toBeNull();
  });

  it("retorna null quando o select só contém o placeholder (sem opções válidas)", () => {
    const onlyPlaceholder = `
      <select id="select_q_bot_payment">
        <option value="0">Selecione uma opção de resposta</option>
      </select>
    `;
    // Sem opções válidas, a extração deve retornar null para que o fluxo de
    // saque acione o fallback seguro (abortar em vez de chutar uma resposta).
    expect(extractAntiBotQuestion(onlyPlaceholder)).toBeNull();
  });

  it("funciona com a pergunta em russo", () => {
    const ruHtml = `
      <label>Что из этого можно съесть?</label>
      <select id="select_q_bot_payment">
        <option value="0">Выберите ответ</option>
        <option value="1">Топор</option>
        <option value="2">Арбуз</option>
      </select>
    `;
    const result = extractAntiBotQuestion(ruHtml);
    expect(result).not.toBeNull();
    expect(result!.question).toBe("Что из этого можно съесть?");
    expect(result!.options.map((o) => o.text)).toEqual(["Топор", "Арбуз"]);
  });
});

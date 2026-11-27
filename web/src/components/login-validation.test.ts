import { describe, expect, it } from "vitest";
import { loginServerFieldErrors, validateLoginFields } from "./login-validation";

describe("login field feedback", () => {
  it("associates both missing fields without changing their values", () => {
    expect(validateLoginFields("   ", "", false)).toEqual({ email: "Informe seu e-mail.", password: "Informe sua senha." });
  });
  it("uses the email input's validity without opening native validation bubbles", () => {
    expect(validateLoginFields("email-invalido", "senha", true)).toEqual({ email: "Informe um e-mail válido, como nome@empresa.com." });
  });
  it("leaves credential validation to the server", () => {
    expect(validateLoginFields("nome@empresa.com", "senha", false)).toEqual({});
  });
  it("maps only explicit field errors from the server", () => {
    expect(loginServerFieldErrors("missing")).toEqual({ email: "Informe seu e-mail.", password: "Informe sua senha." });
    expect(loginServerFieldErrors("email")).toEqual({ email: "Informe um e-mail válido, como nome@empresa.com." });
    expect(loginServerFieldErrors("password")).toEqual({ password: "Informe sua senha." });
  });
  it.each([undefined, "credentials", "rate", "rate-unavailable", "CredentialsSignin"])("does not guess which credential failed for %s", code => {
    expect(loginServerFieldErrors(code)).toEqual({});
  });
});

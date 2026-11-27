export type LoginFieldErrors = { email?: string; password?: string };

export function validateLoginFields(email: string, password: string, emailTypeMismatch: boolean): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  if (!email.trim()) errors.email = "Informe seu e-mail.";
  else if (emailTypeMismatch) errors.email = "Informe um e-mail válido, como nome@empresa.com.";
  if (!password) errors.password = "Informe sua senha.";
  return errors;
}

export function loginServerFieldErrors(code?: string): LoginFieldErrors {
  return {
    ...((code === "missing" || code === "email") ? { email: code === "email" ? "Informe um e-mail válido, como nome@empresa.com." : "Informe seu e-mail." } : {}),
    ...((code === "missing" || code === "password") ? { password: "Informe sua senha." } : {}),
  };
}

export const BCRYPT_PASSWORD_MAX_LENGTH = 72;

export function fitsBcryptPassword(password: string) {
  return new TextEncoder().encode(password).byteLength <= BCRYPT_PASSWORD_MAX_LENGTH;
}

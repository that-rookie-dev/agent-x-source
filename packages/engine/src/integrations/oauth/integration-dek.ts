/** Resolve the encryption key for integration OAuth secrets. */
export function resolveIntegrationDek(authDek: Buffer | null): Buffer | null {
  const machine = process.env['AGENTX_VAULT_KEY'];
  if (machine) {
    try {
      return Buffer.from(machine, 'base64');
    } catch {
      /* fall through to auth DEK */
    }
  }
  return authDek;
}

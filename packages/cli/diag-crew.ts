import { authManager } from '@agentx/shared';
import { CrewManager } from '@agentx/engine';

async function main() {
  const token = await authManager.login('siva', 'Sivasyrex@117');
  const session = authManager.validateSession(token!);
  const pm = new CrewManager();

  console.log('=== BEFORE setDEK ===');
  console.log('All crews:', pm.list().map((c: { name: string }) => c.name));
  console.log('Active:', pm.getActive()?.name);

  console.log('\n=== AFTER setDEK ===');
  pm.setDEK(session!.dek);
  console.log('All crews:', pm.list().map((c: { name: string }) => c.name));
  console.log('User crews:', pm.list().filter((p: { isDefault: boolean }) => !p.isDefault).map((c: { name: string }) => c.name));
  console.log('Active:', pm.getActive()?.name);

  // Now simulate what CrewSelect does — call setDEK again
  console.log('\n=== SECOND setDEK (like useEffect re-run) ===');
  pm.setDEK(session!.dek);
  console.log('All crews:', pm.list().map((c: { name: string }) => c.name));
  console.log('User crews:', pm.list().filter((p: { isDefault: boolean }) => !p.isDefault).map((c: { name: string }) => c.name));
}
main().catch((e: Error) => console.error('FATAL:', e.message));

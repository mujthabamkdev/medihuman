import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createTestServer } from './src/backend/api.js';

export { default } from './src/backend/vercel-handler.js';

const port = Number.parseInt(process.env.PORT || '4173', 10);

if (process.env.VERCEL !== '1' && process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await createTestServer({
    publicRoot: process.env.PUBLIC_ROOT ? resolve(process.env.PUBLIC_ROOT) : undefined,
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`MediHuman running at http://localhost:${port}`);
  });
}

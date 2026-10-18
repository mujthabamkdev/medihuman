import { fileURLToPath } from 'node:url';
import { createTestServer } from './src/backend/api.js';

const port = Number.parseInt(process.env.PORT || '4173', 10);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await createTestServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`MediHuman running at http://localhost:${port}`);
  });
}

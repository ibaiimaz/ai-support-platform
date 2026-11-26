import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createApplicationDependencies } from './composition.js';
import { buildApp } from './http/app.js';
import { loadRagConfig } from './knowledge/config.js';

export async function startApplication(
  compose = () => createApplicationDependencies(loadConfig(), loadRagConfig()),
  createApp = buildApp,
) {
  const composition = await compose();
  let app: ReturnType<typeof buildApp> | undefined;
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const closeOnSignal = () => {
    void app?.close().catch(() => {
      console.error('No se pudo completar el cierre de la aplicación.');
      process.exitCode = 1;
    });
  };
  try {
    app = createApp(composition.dependencies, true);
    app.addHook('onClose', async () => {
      for (const signal of signals) {
        process.removeListener(signal, closeOnSignal);
      }
      await composition.close();
    });
    await app.listen({ host: '127.0.0.1', port: 3000 });
    for (const signal of signals) {
      process.once(signal, closeOnSignal);
    }
    return app;
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await composition.close();
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  startApplication().catch(() => {
    console.error('No se pudo iniciar la aplicación. Compruebe la configuración y el puerto 3000.');
    process.exitCode = 1;
  });
}

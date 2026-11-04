import { loadConfig } from './config.js';
import { OllamaClassifier } from './infrastructure/ollama/ollama-classifier.js';
import { buildApp } from './http/app.js';

try {
  const app = buildApp(new OllamaClassifier(loadConfig()), true);
  await app.listen({ host: '127.0.0.1', port: 3000 });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close();
    });
  }
} catch {
  console.error('No se pudo iniciar la aplicación. Compruebe la configuración y el puerto 3000.');
  process.exitCode = 1;
}

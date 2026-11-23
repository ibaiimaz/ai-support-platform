import { loadConfig } from './config.js';
import { createClassificationDependencies } from './composition.js';
import { buildApp } from './http/app.js';
import { registerKnowledgeRoute } from './http/knowledge-route.js';
import { loadRagConfig } from './knowledge/config.js';
import { createKnowledgeDependencies } from './knowledge/composition.js';

try {
  const app = buildApp(createClassificationDependencies(loadConfig()), true);
  const ragConfig = loadRagConfig();
  const knowledge = createKnowledgeDependencies(ragConfig);
  registerKnowledgeRoute(app, knowledge.dependencies, ragConfig.maxQuestionLength);
  app.addHook('onClose', () => knowledge.close());
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

import { loadRagConfig } from './config.js';
import { createKnowledgeDependencies } from './composition.js';
import { readCorpus } from './markdown.js';
import { migrateKnowledge } from './postgres.js';
import { ingestKnowledgeDocument } from './use-cases.js';

async function main() {
  const [command, mode = '--check', ...extra] = process.argv.slice(2);
  if (
    !['migrate', 'ingest'].includes(command ?? '') ||
    !['--check', '--run'].includes(mode) ||
    extra.length
  ) {
    throw new Error('Usage: knowledge:migrate|knowledge:ingest -- --check|--run');
  }
  const config = loadRagConfig();
  if (command === 'ingest') {
    const documents = await readCorpus(config.documentsDirectory);
    if (mode === '--check') {
      console.log(JSON.stringify({ mode: 'CHECK', documents: documents.length, inference: false }));
      return;
    }
    const composition = createKnowledgeDependencies(config);
    try {
      for (const document of documents) {
        const result = await ingestKnowledgeDocument(
          composition.dependencies.repository,
          composition.dependencies.embeddings,
          document,
          config,
        );
        console.log(JSON.stringify(result));
      }
    } finally {
      await composition.close();
    }
  } else if (mode === '--check') {
    console.log(
      JSON.stringify({ mode: 'CHECK', migration: '007', databaseAccess: false, inference: false }),
    );
  } else {
    const composition = createKnowledgeDependencies(config);
    try {
      await migrateKnowledge(composition.pool);
      console.log(JSON.stringify({ migration: '007', status: 'APPLIED_OR_UNCHANGED' }));
    } finally {
      await composition.close();
    }
  }
}

main().catch(() => {
  console.error(
    'La operación de conocimiento no pudo completarse. No se publican detalles internos.',
  );
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeDocument } from './domain.js';

export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

export function parseMarkdown(bytes: Uint8Array): KnowledgeDocument {
  if (bytes.byteLength > 1_048_576) {
    throw new Error('Document exceeds size limit');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n');
  if (text.includes('\0')) {
    throw new Error('NUL is not supported in Markdown documents');
  }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) {
    throw new Error('Document front matter required');
  }
  const metadata: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const field = /^(documentId|title):[ \t]+(.+)$/.exec(line);
    if (!field || metadata[field[1]!] !== undefined) {
      throw new Error('Invalid document metadata');
    }
    metadata[field[1]!] = field[2]!.trim();
  }
  if (
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(metadata.documentId ?? '') ||
    !metadata.title ||
    Array.from(metadata.title).length > 200 ||
    !match[2]!.trim()
  ) {
    throw new Error('Invalid document');
  }
  return {
    documentId: metadata.documentId!,
    title: metadata.title,
    body: match[2]!,
    contentHash: hash(bytes),
  };
}

export function chunkMarkdown(body: string, size: number, overlap: number) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    !Number.isInteger(overlap) ||
    overlap < 0 ||
    overlap >= size
  ) {
    throw new Error('Invalid chunk configuration');
  }
  const sections: { section: string; content: string }[] = [];
  const headings: string[] = [];
  let content: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const text = content.join('\n').trim();
    if (text) {
      sections.push({ section: headings.join(' > ') || 'Introducción', content: text });
    }
    content = [];
  };
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const boundary = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (boundary) {
      if (!fence) {
        fence = boundary;
      } else if (
        boundary[0] === fence[0] &&
        boundary.length >= fence.length &&
        /^ {0,3}[`~]+\s*$/.test(line)
      ) {
        fence = null;
      }
    }
    const heading = !fence && /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      headings.length = heading[1]!.length - 1;
      headings.push(heading[2]!.trim());
    }
    content.push(line);
  }
  flush();
  const chunks: { section: string; position: number; content: string }[] = [];
  for (const section of sections) {
    const points = Array.from(section.content);
    let start = 0;
    while (start < points.length) {
      let end = Math.min(start + size, points.length);
      if (end < points.length) {
        const newline = points.slice(start, end).lastIndexOf('\n');
        if (newline > Math.max(overlap, Math.floor(size / 2))) {
          end = start + newline + 1;
        }
      }
      const text = points.slice(start, end).join('').trim();
      if (text) {
        chunks.push({ section: section.section, position: chunks.length, content: text });
      }
      if (end === points.length) {
        break;
      }
      start = end - overlap;
    }
  }
  if (!chunks.length || chunks.length > 1000) {
    throw new Error('Invalid document chunk count');
  }
  return chunks;
}

export async function readCorpus(directory: string): Promise<KnowledgeDocument[]> {
  const documents: KnowledgeDocument[] = [];

  async function visit(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Corpus symlinks are not allowed');
      }
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        documents.push(parseMarkdown(await readFile(full)));
        if (documents.length > 100) {
          throw new Error('Corpus document limit exceeded');
        }
      }
    }
  }

  await visit(directory);
  if (!documents.length || new Set(documents.map((d) => d.documentId)).size !== documents.length) {
    throw new Error('Empty corpus or duplicate document identity');
  }
  return documents.sort((a, b) => a.documentId.localeCompare(b.documentId));
}

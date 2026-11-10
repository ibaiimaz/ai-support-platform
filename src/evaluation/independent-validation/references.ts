import type { ModelIdentity } from '../model-comparison/protocol.js';

export const freezeSha256 = '9cb6cf0f0a1a91aacee14cda22d383b56aa1b096068e8fd1a2b1d802952ff810';

export const modelReferences: Record<'llama3.1:8b' | 'gemma3:12b', ModelIdentity> = {
  'llama3.1:8b': {
    digest: '46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e',
    templateSha256: '948af2743fc78a328dcb3b0f5a31b3d75f415840fdb699e8b1235978392ecf85',
    parametersSha256: '2801e61a8848e505a6e20beeaea63cca1600200f6720e5f916ba7d6da5c3ba39',
    parameters:
      'stop                           "<|start_header_id|>"\nstop                           "<|end_header_id|>"\nstop                           "<|eot_id|>"',
    quantization: 'Q4_K_M',
    modelContextLength: 131072,
    storedBytes: 4920753328,
  },
  'gemma3:12b': {
    digest: 'b92b218582c521ba287f38f1d6057dcd3c6cbff036f13cac97b5d861f5e58ec3',
    templateSha256: 'e0a42594d802e5d31cdc786deb4823edb8adff66094d49de8fffe976d753e348',
    parametersSha256: '82be0d39faf8dbd5f010de5f8619825954ef45533a1df7db4973110e71cef2d6',
    parameters:
      'stop                           "<end_of_turn>"\ntemperature                    1\ntop_k                          64\ntop_p                          0.95',
    quantization: 'Q4_K_M',
    modelContextLength: 131072,
    storedBytes: 8164039732,
  },
};

export const hostSha256 = '94f0768b82abba7ffbe81d8272135fac2699ab9d31b65b8807abf64c14714efa';

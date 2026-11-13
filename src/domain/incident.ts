import type { Category } from './classification.js';

export interface Incident {
  id: string;
  title: string;
  description: string;
  category: Category;
}

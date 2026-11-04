export const categories = ['BUG', 'FEATURE', 'QUESTION'] as const;

export type Category = (typeof categories)[number];

export interface Classification {
  category: Category;
}

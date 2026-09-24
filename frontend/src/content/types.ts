/** One entry of a docs page's "On this page" list. */
export interface TocItem {
  id: string;
  text: string;
  depth: 2 | 3;
}

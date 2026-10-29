import { useEffect } from 'react';

/** Names each page in the browser tab and for screen readers (WCAG 2.4.2). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

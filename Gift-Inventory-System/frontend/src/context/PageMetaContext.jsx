/* Page title + breadcrumb shown in the admin top bar. Pages call usePageMeta('Gift List', 'Gifts'). */
import { createContext, useContext, useEffect, useState } from 'react';

const PageMetaContext = createContext({ meta: {}, setMeta: () => {} });

export function PageMetaProvider({ children }) {
  const [meta, setMeta] = useState({ title: '', crumb: '' });
  return <PageMetaContext.Provider value={{ meta, setMeta }}>{children}</PageMetaContext.Provider>;
}
export const usePageMetaValue = () => useContext(PageMetaContext).meta;

export function usePageMeta(title, crumb, docTitleSuffix = 'Gift Inventory') {
  const { setMeta } = useContext(PageMetaContext);
  useEffect(() => {
    setMeta({ title: title || '', crumb: crumb || '' });
    document.title = `${title || 'Admin'} · ${docTitleSuffix}`;
  }, [title, crumb, docTitleSuffix, setMeta]);
}

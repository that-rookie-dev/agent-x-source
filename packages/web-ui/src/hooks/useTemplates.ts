import { useCallback, useEffect, useState } from 'react';
import type { DocumentTemplate, TemplateFillResult, UpdateDocumentTemplateInput } from '@agentx/shared';
import { templates as templatesApi } from '../api';

export function useTemplates() {
  const [items, setItems] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const list = await templatesApi.list();
      setItems(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while any template is still discovering fields.
  useEffect(() => {
    const analyzing = items.some(
      (t) => t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending',
    );
    if (!analyzing) return;
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [items, refresh]);

  const upload = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const template = await templatesApi.upload(file);
      setItems((prev) => [template, ...prev.filter((t) => t.id !== template.id)]);
      setError(null);
      return template;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const update = useCallback(async (id: string, patch: UpdateDocumentTemplateInput) => {
    const template = await templatesApi.update(id, patch);
    setItems((prev) => prev.map((t) => (t.id === id ? template : t)));
    return template;
  }, []);

  const rescan = useCallback(async (id: string) => {
    const template = await templatesApi.rescan(id);
    setItems((prev) => prev.map((t) => (t.id === id ? template : t)));
    return template;
  }, []);

  const fill = useCallback(async (
    id: string,
    values: Record<string, string>,
    outputName?: string,
  ): Promise<TemplateFillResult> => {
    setBusy(true);
    try {
      return await templatesApi.fill(id, { values, outputName });
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await templatesApi.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    items,
    loading,
    error,
    busy,
    refresh,
    upload,
    update,
    rescan,
    fill,
    remove,
    setError,
  };
}

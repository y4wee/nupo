import { useState, useEffect, useCallback } from 'react';
import { NupoConfig } from '../types/index.js';
import {
  readConfig,
  patchConfig as patchConfigService,
  configExists,
} from '../services/config.js';

export interface UseConfigResult {
  config: NupoConfig | null;
  loading: boolean;
  patch: (partial: Partial<NupoConfig>) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useConfig(): UseConfigResult {
  const [config, setConfig] = useState<NupoConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const exists = await configExists();
    if (exists) {
      const c = await readConfig();
      setConfig(c);
    } else {
      setConfig(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (partial: Partial<NupoConfig>) => {
      await patchConfigService(partial);
      await load();
    },
    [load],
  );

  return { config, loading, patch, refresh: load };
}

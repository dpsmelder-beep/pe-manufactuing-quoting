import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('getAccounts', {});
        setCustomers(res.data.accounts || []);
      } catch (err) {
        console.error('Failed to load accounts', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { customers, loading };
}

export function customerLabel(c) {
  return c.name;
}
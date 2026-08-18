import { useState, useEffect, useCallback } from 'react';
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

export function useContacts(accountId) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id) => {
    if (!id) { setContacts([]); return; }
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getContacts', { account_id: id });
      setContacts(res.data.contacts || []);
    } catch (err) {
      console.error('Failed to load contacts', err);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(accountId);
  }, [accountId, load]);

  return { contacts, loading, reload: load };
}

export function contactName(c) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ');
}
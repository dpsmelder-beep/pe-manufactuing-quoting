import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await base44.entities.Customer.list('-created_date', 500);
        setCustomers(data);
      } catch (err) {
        console.error('Failed to load customers', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { customers, loading };
}

export function customerLabel(c) {
  return c.company ? `${c.company} — ${c.name}` : c.name;
}
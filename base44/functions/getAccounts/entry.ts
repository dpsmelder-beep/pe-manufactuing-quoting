import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const apiKey = secrets.get('PE_MANUFACTURING_ARM_API_KEY');
    if (!apiKey) return Response.json({ error: 'API key not configured' }, { status: 500 });

    const res = await fetch('https://pe-manufacturing-arm.base44.app/api/entities/Account?limit=500&sort_by=name', {
      headers: { 'api_key': apiKey }
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Failed to fetch accounts: ${res.status} ${text}` }, { status: 502 });
    }
    const data = await res.json();
    const accounts = (Array.isArray(data) ? data : (data.items || data.data || [])).map((a) => ({
      id: a.id,
      name: a.name,
      industry: a.industry,
      billing_address: a.billing_address
    }));

    return Response.json({ accounts });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
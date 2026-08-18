import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const apiKey = secrets.get('PE_MANUFACTURING_ARM_API_KEY');
    if (!apiKey) return Response.json({ error: 'API key not configured' }, { status: 500 });

    let body = {};
    try { body = await req.json(); } catch (e) {}
    const accountId = body.account_id;
    const filter = accountId ? { account_id: accountId } : {};
    const q = encodeURIComponent(JSON.stringify(filter));
    const url = `https://pe-manufacturing-arm.base44.app/api/entities/Contact?limit=500&sort_by=last_name&q=${q}`;

    const res = await fetch(url, { headers: { 'api_key': apiKey } });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Failed to fetch contacts: ${res.status} ${text}` }, { status: 502 });
    }
    const data = await res.json();
    const contacts = (Array.isArray(data) ? data : (data.items || data.data || [])).map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone
    }));

    return Response.json({ contacts });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
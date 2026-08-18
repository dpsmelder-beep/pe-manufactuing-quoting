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
    const dealId = body.deal_id;
    if (!dealId) return Response.json({ error: 'Deal ID required' }, { status: 400 });

    const res = await fetch(`https://pe-manufacturing-arm.base44.app/api/entities/Deal/${dealId}`, {
      headers: { 'api_key': apiKey }
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Failed to fetch deal: ${res.status} ${text}` }, { status: 502 });
    }
    const deal = await res.json();

    // Resolve account name if an account_id is present
    let account_name = deal.account_name || '';
    if (deal.account_id && !account_name) {
      try {
        const aRes = await fetch(`https://pe-manufacturing-arm.base44.app/api/entities/Account/${deal.account_id}`, {
          headers: { 'api_key': apiKey }
        });
        if (aRes.ok) {
          const acct = await aRes.json();
          account_name = acct.name || '';
        }
      } catch (e) {}
    }

    // Resolve contact name/email if a contact_id is present
    let contact_name = deal.contact_name || '';
    let contact_email = deal.contact_email || '';
    if (deal.contact_id) {
      try {
        const cRes = await fetch(`https://pe-manufacturing-arm.base44.app/api/entities/Contact/${deal.contact_id}`, {
          headers: { 'api_key': apiKey }
        });
        if (cRes.ok) {
          const c = await cRes.json();
          contact_name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
          contact_email = c.email || '';
        }
      } catch (e) {}
    }

    return Response.json({
      deal: {
        id: deal.id,
        title: deal.title || deal.name || '',
        value: deal.value ?? deal.amount ?? null,
        account_id: deal.account_id || '',
        account_name,
        contact_id: deal.contact_id || '',
        contact_name,
        contact_email,
        product: deal.product || deal.product_name || '',
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { quoteId } = body;

    if (!quoteId) return Response.json({ error: 'Quote ID required' }, { status: 400 });

    const quote = await base44.entities.Quote.get(quoteId);
    if (!quote) return Response.json({ error: 'Quote not found' }, { status: 404 });
    if (!quote.customer_email) return Response.json({ error: 'No customer email on quote' }, { status: 400 });

    const html = buildQuoteEmail(quote);

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: quote.customer_email,
      subject: `Quote ${quote.quote_number} - ${quote.project_name}`,
      body: html,
    });

    await base44.entities.Quote.update(quoteId, { status: 'sent' });

    return Response.json({ success: true, message: 'Quote sent successfully' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function buildQuoteEmail(quote) {
  const typeLabel = (quote.project_type || '').replace(/_/g, ' ');
  const rows = (quote.line_items || []).map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.description || ''}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity || 0}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${(item.unit_price || 0).toFixed(2)}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}</td>
    </tr>
  `).join('');

  const laborCost = (quote.labor_hours || 0) * (quote.labor_rate || 0);

  return `
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #333;">
      <div style="background: #1a1a2e; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Quote ${quote.quote_number}</h1>
        <p style="color: #aaa; margin: 5px 0 0 0; text-transform: capitalize;">${typeLabel}</p>
      </div>
      <div style="padding: 24px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${quote.customer_name},</p>
        <p>Thank you for your inquiry regarding <strong>${quote.project_name}</strong>. Please find our quote details below:</p>

        <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Description</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #ddd;">Qty</th>
              <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Unit Price</th>
              <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${laborCost > 0 ? `
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">Labor (${quote.labor_hours} hrs @ $${quote.labor_rate}/hr)</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">1</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${laborCost.toFixed(2)}</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${laborCost.toFixed(2)}</td>
            </tr>` : ''}
          </tbody>
        </table>

        <div style="text-align: right; margin: 20px 0; padding: 12px; background: #f5f5f5; border-radius: 6px;">
          <p style="font-size: 22px; font-weight: bold; margin: 0;">Total: $${(quote.total || 0).toFixed(2)}</p>
        </div>

        <div style="background: #f9f9f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Lead Time:</strong> ${quote.lead_time_days || 'TBD'} ${quote.lead_time_days ? 'days' : ''}</p>
        </div>

        ${quote.notes ? `<p><strong>Notes:</strong></p><p style="background: #f9f9f9; padding: 12px; border-radius: 6px; white-space: pre-wrap;">${quote.notes}</p>` : ''}

        <p>Please contact us to proceed with this quote or if you have any questions.</p>
        <p>Best regards,<br/>Manufacturing Team</p>
      </div>
    </body>
    </html>
  `;
}
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import StatusBadge from '@/components/StatusBadge';
import CADViewer from '@/components/CADViewer';
import LineItemsTable from '@/components/LineItemsTable';
import ReviewNotesSection from '@/components/ReviewNotesSection';
import { ArrowLeft, Save, Send, FileText, Box, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCustomers, customerLabel } from '@/hooks/useCustomers';

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { customers, loading: loadingCustomers } = useCustomers();

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lineItems, setLineItems] = useState([]);
  const [reviewNotes, setReviewNotes] = useState([]);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('new');
  const [selectedFile, setSelectedFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerRfqNumber, setCustomerRfqNumber] = useState('');
  const [salesRepName, setSalesRepName] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [salesTerms, setSalesTerms] = useState('');

  const handleCustomerSelect = (custId) => {
    const c = customers.find((x) => x.id === custId);
    setCustomerId(custId);
    setCustomerName(c ? c.name : '');
    setCustomerContact(c ? c.name : '');
    setCustomerEmail(c ? c.email || '' : '');
  };

  useEffect(() => {
    loadQuote();
  }, [id]);

  const loadQuote = async () => {
    try {
      const q = await base44.entities.Quote.get(id);
      setQuote(q);
      setLineItems(q.line_items || []);
      setReviewNotes(q.review_notes || []);
      setNotes(q.notes || '');
      setStatus(q.status || 'new');
      setCustomerId(q.customer_id || '');
      setCustomerName(q.customer_name || '');
      setCustomerContact(q.customer_contact || '');
      setCustomerEmail(q.customer_email || '');
      setCustomerRfqNumber(q.customer_rfq_number || '');
      setSalesRepName(q.sales_rep_name || '');
      setQuoteNumber(q.quote_number || '');
      setSalesTerms(q.sales_terms || '');
      if (q.files && q.files.length > 0) setSelectedFile(q.files[0]);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load quote', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const lineItemsTotal = lineItems.reduce((s, i) => s + (i.quantity || 0) * (i.price || 0), 0);
  const total = lineItemsTotal;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId,
        customer_name: customerName,
        customer_contact: customerContact,
        customer_email: customerEmail,
        customer_rfq_number: customerRfqNumber,
        sales_rep_name: salesRepName,
        sales_terms: salesTerms,
        line_items: lineItems,
        notes,
        status,
        subtotal: total,
        total,
      };
      await base44.entities.Quote.update(id, payload);
      toast({ title: 'Saved', description: 'Quote updated' });
      setQuote({ ...quote, ...payload });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to save', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!quote.customer_email) {
      toast({ title: 'Error', description: 'No customer email on this quote', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      await base44.entities.Quote.update(id, {
        customer_id: customerId,
        customer_name: customerName,
        customer_contact: customerContact,
        customer_email: customerEmail,
        customer_rfq_number: customerRfqNumber,
        sales_rep_name: salesRepName,
        sales_terms: salesTerms,
        line_items: lineItems,
        notes,
        status: 'sent',
        subtotal: total,
        total,
      });
      await base44.functions.invoke('sendQuote', { quoteId: id });
      toast({ title: 'Sent', description: 'Quote emailed to customer' });
      setStatus('sent');
      setQuote({ ...quote, status: 'sent' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to send quote: ' + (err.message || 'Unknown error'), variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleAddNote = (text) => {
    const note = { text, author: 'Team Member', date: new Date().toISOString() };
    const updated = [...reviewNotes, note];
    setReviewNotes(updated);
    base44.entities.Quote.update(id, { review_notes: updated });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!quote) {
    return <div className="p-6 text-center text-slate-500">Quote not found.</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{quoteNumber}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-slate-500">{customerName}{customerContact ? ` • ${customerContact}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="quoted">Quoted</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Send Quote
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Box className="w-5 h-5" /> 3D Model Viewer
            </h2>
            {quote.files && quote.files.length > 0 ? (
              <>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {quote.files.map((f, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedFile(f)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1',
                        selectedFile?.url === f.url ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      <FileText className="w-3 h-3" />
                      {f.name}
                    </button>
                  ))}
                </div>
                <div className="h-[500px]">
                  {selectedFile && <CADViewer fileUrl={selectedFile.url} fileName={selectedFile.name} />}
                </div>
              </>
            ) : (
              <div className="h-[400px] flex flex-col items-center justify-center text-slate-400">
                <Box className="w-12 h-12 mb-2 opacity-30" />
                <p>No CAD files uploaded for this quote.</p>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-3">Line Items</h2>
            <LineItemsTable items={lineItems} onChange={setLineItems} />
            <div className="mt-4 pt-4 border-t flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold">Quote Info</h2>
            <div>
              <Label className="text-xs">Quote Number</Label>
              <Input value={quoteNumber} readOnly className="bg-slate-50" />
            </div>
            <div>
              <Label className="text-xs">Customer Name</Label>
              <Select value={customerId} onValueChange={handleCustomerSelect} disabled={loadingCustomers}>
                <SelectTrigger><SelectValue placeholder={loadingCustomers ? 'Loading...' : 'Select customer'} /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{customerLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Customer Contact</Label>
              <Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Customer Email</Label>
              <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Customer RFQ #</Label>
              <Input value={customerRfqNumber} onChange={(e) => setCustomerRfqNumber(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Sales Rep</Label>
              <Input value={salesRepName} onChange={(e) => setSalesRepName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Sales Terms</Label>
              <Textarea value={salesTerms} onChange={(e) => setSalesTerms(e.target.value)} rows={3} />
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-4 space-y-2">
        <Label>General Note</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Review Notes & Feedback</h2>
        <ReviewNotesSection notes={reviewNotes} onAdd={handleAddNote} />
      </Card>
    </div>
  );
}
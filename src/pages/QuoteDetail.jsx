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

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lineItems, setLineItems] = useState([]);
  const [reviewNotes, setReviewNotes] = useState([]);
  const [laborHours, setLaborHours] = useState(0);
  const [laborRate, setLaborRate] = useState(0);
  const [leadTime, setLeadTime] = useState(0);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('new');
  const [selectedFile, setSelectedFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadQuote();
  }, [id]);

  const loadQuote = async () => {
    try {
      const q = await base44.entities.Quote.get(id);
      setQuote(q);
      setLineItems(q.line_items || []);
      setReviewNotes(q.review_notes || []);
      setLaborHours(q.labor_hours || 0);
      setLaborRate(q.labor_rate || 0);
      setLeadTime(q.lead_time_days || 0);
      setNotes(q.notes || '');
      setStatus(q.status || 'new');
      if (q.files && q.files.length > 0) setSelectedFile(q.files[0]);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load quote', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const lineItemsTotal = lineItems.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  const laborCost = (laborHours || 0) * (laborRate || 0);
  const subtotal = lineItemsTotal + laborCost;
  const total = subtotal;

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.Quote.update(id, {
        line_items: lineItems,
        labor_hours: laborHours,
        labor_rate: laborRate,
        lead_time_days: leadTime,
        notes,
        status,
        subtotal,
        total,
      });
      toast({ title: 'Saved', description: 'Quote updated' });
      setQuote({ ...quote, status, line_items: lineItems, subtotal, total });
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
        line_items: lineItems,
        labor_hours: laborHours,
        labor_rate: laborRate,
        lead_time_days: leadTime,
        notes,
        status: 'sent',
        subtotal,
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
              <h1 className="text-2xl font-bold">{quote.project_name}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-slate-500">{quote.quote_number} • {quote.customer_name}</p>
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
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4">
            <h2 className="font-semibold mb-3">Line Items</h2>
            <LineItemsTable items={lineItems} onChange={setLineItems} />
            <div className="mt-4 pt-4 border-t space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Labor Hours</Label>
                  <Input type="number" value={laborHours} onChange={(e) => setLaborHours(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">Labor Rate ($/hr)</Label>
                  <Input type="number" value={laborRate} onChange={(e) => setLaborRate(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Line Items:</span>
              <span className="font-medium">${lineItemsTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Labor:</span>
              <span className="font-medium">${laborCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal:</span>
              <span className="font-medium">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-500">
              <span>Lead Time:</span>
              <span>{leadTime || 'TBD'} {leadTime ? 'days' : ''}</span>
            </div>
          </Card>

          <Card className="p-4">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1" />
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Review Notes & Feedback</h2>
        <ReviewNotesSection notes={reviewNotes} onAdd={handleAddNote} />
      </Card>
    </div>
  );
}
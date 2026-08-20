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
import { ArrowLeft, Save, Send, FileText, Box, Loader2, Download, ScanLine } from 'lucide-react';
import PdfViewer from '@/components/PdfViewer';
import DrawingAnalysis from '@/components/DrawingAnalysis';
import ErrorBoundary from '@/components/ErrorBoundary';
import { generateQuotePdf } from '@/lib/generateQuotePdf';
import { cn } from '@/lib/utils';
import { useCustomers, customerLabel, useContacts, contactName } from '@/hooks/useCustomers';

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
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [viewMode, setViewMode] = useState('cad');
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [contactId, setContactId] = useState('');
  const { contacts, loading: loadingContacts } = useContacts(customerId);
  const [customerRfqNumber, setCustomerRfqNumber] = useState('');
  const [salesRepName, setSalesRepName] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [salesTerms, setSalesTerms] = useState('');

  const handleCustomerSelect = (custId) => {
    const c = customers.find((x) => x.id === custId);
    setCustomerId(custId);
    setCustomerName(c ? c.name : '');
    setContactId('');
    setCustomerContact('');
    setCustomerEmail('');
  };

  const handleContactSelect = (cid) => {
    const c = contacts.find((x) => x.id === cid);
    setContactId(cid);
    setCustomerContact(c ? contactName(c) : '');
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
      setDocuments(q.documents || []);
      setSelectedDoc(q.documents && q.documents.length > 0 ? q.documents[0] : null);
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
        documents,
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
        documents,
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

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      await generateQuotePdf({
        quote_number: quoteNumber,
        customer_name: customerName,
        customer_contact: customerContact,
        customer_email: customerEmail,
        customer_rfq_number: customerRfqNumber,
        sales_rep_name: salesRepName,
        sales_terms: salesTerms,
        notes,
        line_items: lineItems,
        subtotal: total,
        total,
        status,
      });
      toast({ title: 'PDF ready', description: 'Saved to your downloads' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to generate PDF', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const handleDocUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploadingDocs(true);
    try {
      const uploaded = [];
      for (const file of selected) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploaded.push({ url: file_url, name: file.name });
      }
      const updated = [...documents, ...uploaded];
      setDocuments(updated);
      await base44.entities.Quote.update(id, { documents: updated });
      toast({ title: 'Documents uploaded', description: `${uploaded.length} file(s) added` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingDocs(false);
    }
  };

  const removeDoc = async (index) => {
    const updated = documents.filter((_, i) => i !== index);
    setDocuments(updated);
    await base44.entities.Quote.update(id, { documents: updated });
  };

  const handleFileUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploadingFiles(true);
    try {
      const uploaded = [];
      for (const file of selected) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploaded.push({ url: file_url, name: file.name });
      }
      const q = await base44.entities.Quote.get(id);
      const existing = q.files || [];
      const updated = [...existing, ...uploaded];
      await base44.entities.Quote.update(id, { files: updated });
      setQuote({ ...q, files: updated });
      if (!selectedFile && updated.length > 0) setSelectedFile(updated[0]);
      toast({ title: 'CAD files uploaded', description: `${uploaded.length} file(s) added` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingFiles(false);
    }
  };

  const removeFile = async (index) => {
    const q = await base44.entities.Quote.get(id);
    const updated = (q.files || []).filter((_, i) => i !== index);
    await base44.entities.Quote.update(id, { files: updated });
    setQuote({ ...q, files: updated });
    if (selectedFile && updated.findIndex((f) => f.url === selectedFile.url) === -1) {
      setSelectedFile(updated[0] || null);
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
          <Button variant="secondary" onClick={handleDownloadPdf} disabled={downloading}>
            {downloading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
            Download PDF
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
            <div className="flex gap-1 mb-3 border-b border-slate-200">
              <button
                onClick={() => setViewMode('cad')}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px flex items-center gap-2',
                  viewMode === 'cad' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <Box className="w-4 h-4" /> 3D Model
              </button>
              <button
                onClick={() => setViewMode('pdf')}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px flex items-center gap-2',
                  viewMode === 'pdf' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <FileText className="w-4 h-4" /> PDF Document
              </button>
              <button
                onClick={() => setViewMode('analysis')}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px flex items-center gap-2',
                  viewMode === 'analysis' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <ScanLine className="w-4 h-4" /> Drawing Analysis
              </button>
            </div>

            {viewMode === 'analysis' ? (
              <DrawingAnalysis
                documents={documents}
                selectedDoc={selectedDoc}
                onSelectDoc={setSelectedDoc}
              />
            ) : viewMode === 'cad' ? (
              <>
                <label className="border-2 border-dashed border-slate-300 rounded-lg p-3 mb-3 flex items-center justify-center gap-2 cursor-pointer hover:border-slate-400 transition">
                  <Box className="w-5 h-5 text-slate-400" />
                  <span className="text-sm text-slate-500">
                    {uploadingFiles ? 'Uploading...' : 'Add STEP / IGES / BREP file'}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".step,.stp,.iges,.igs,.brep"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={uploadingFiles}
                  />
                </label>
                {quote.files && quote.files.length > 0 ? (
                  <>
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {quote.files.map((f, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <button
                            onClick={() => setSelectedFile(f)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1',
                              selectedFile?.url === f.url ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            )}
                          >
                            <FileText className="w-3 h-3" />
                            {f.name}
                          </button>
                          <Button variant="ghost" size="sm" onClick={() => removeFile(i)} className="h-7 px-2 text-xs">Remove</Button>
                        </div>
                      ))}
                    </div>
                    <div className="h-[500px]">
                      {selectedFile && <CADViewer fileUrl={selectedFile.url} fileName={selectedFile.name} />}
                    </div>
                  </>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-slate-400">
                    <Box className="w-12 h-12 mb-2 opacity-30" />
                    <p>No CAD files uploaded for this quote.</p>
                  </div>
                )}
              </>
            ) : (
              documents.length > 0 ? (
                <>
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {documents.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedDoc(d)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1',
                          selectedDoc?.url === d.url ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        )}
                      >
                        <FileText className="w-3 h-3" />
                        {d.name}
                      </button>
                    ))}
                  </div>
                  <div className="h-[500px] overflow-y-auto bg-slate-50 rounded-lg p-3">
                    {selectedDoc && (
                      <ErrorBoundary fallback={<p className="text-sm text-slate-500 text-center py-4">PDF preview unavailable. <a href={selectedDoc.url} target="_blank" rel="noreferrer" className="text-primary underline">Open in new tab</a></p>}>
                        <PdfViewer url={selectedDoc.url} height={480} />
                      </ErrorBoundary>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-[400px] flex flex-col items-center justify-center text-slate-400">
                  <FileText className="w-12 h-12 mb-2 opacity-30" />
                  <p>No PDF documents uploaded for this quote.</p>
                </div>
              )
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

          <Card className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><FileText className="w-5 h-5" /> Reference Documents (PDF)</h2>
            <label className="border-2 border-dashed border-slate-300 rounded-lg p-5 flex flex-col items-center justify-center cursor-pointer hover:border-slate-400 transition">
              <FileText className="w-6 h-6 text-slate-400 mb-1" />
              <span className="text-sm text-slate-500">Click to upload PDF drawings or specs</span>
              <span className="text-xs text-slate-400 mt-1">.pdf</span>
              <input type="file" multiple accept="application/pdf,.pdf" className="hidden" onChange={handleDocUpload} disabled={uploadingDocs} />
            </label>
            {uploadingDocs && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
              </div>
            )}
            {documents.length > 0 && (
              <>
                <div className="space-y-2">
                  {documents.map((d, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
                      <button
                        onClick={() => { setSelectedDoc(d); setViewMode('pdf'); }}
                        className={cn(
                          'text-sm font-medium truncate underline-offset-2 flex items-center gap-2 text-left flex-1',
                          selectedDoc?.url === d.url ? 'text-primary underline' : 'text-slate-700 hover:text-primary hover:underline'
                        )}
                      >
                        <FileText className="w-4 h-4 shrink-0" /> <span className="truncate">{d.name}</span>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-primary px-2">Open</a>
                        <Button variant="ghost" size="sm" onClick={() => removeDoc(i)}>Remove</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
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
              <Select value={contactId} onValueChange={handleContactSelect} disabled={!customerId || loadingContacts}>
                <SelectTrigger><SelectValue placeholder={!customerId ? 'Select customer first' : loadingContacts ? 'Loading...' : 'Select contact'} /></SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{contactName(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
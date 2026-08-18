import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, ArrowLeft, Loader2 } from 'lucide-react';
import { useCustomers, customerLabel, useContacts, contactName } from '@/hooks/useCustomers';

export default function NewQuote() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { customers, loading: loadingCustomers } = useCustomers();

  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [contactId, setContactId] = useState('');
  const { contacts, loading: loadingContacts } = useContacts(customerId);
  const [customerRfqNumber, setCustomerRfqNumber] = useState('');
  const [salesRepName, setSalesRepName] = useState('');
  const [salesTerms, setSalesTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCustomerSelect = (id) => {
    const c = customers.find((x) => x.id === id);
    setCustomerId(id);
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

  const handleFileUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of selected) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploaded.push({ url: file_url, name: file.name });
      }
      setFiles([...files, ...uploaded]);
      toast({ title: 'Files uploaded', description: `${uploaded.length} file(s) added` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index) => setFiles(files.filter((_, i) => i !== index));

  const handleSubmit = async () => {
    if (!customerName) {
      toast({ title: 'Missing info', description: 'Customer name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const quoteNumber = `Q-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${String(Date.now()).slice(-4)}`;

      const quote = await base44.entities.Quote.create({
        quote_number: quoteNumber,
        customer_id: customerId,
        customer_name: customerName,
        customer_contact: customerContact,
        customer_email: customerEmail,
        customer_rfq_number: customerRfqNumber,
        sales_rep_name: salesRepName,
        sales_terms: salesTerms,
        files,
        notes,
        status: 'new',
        line_items: [],
        review_notes: [],
        subtotal: 0,
        total: 0,
      });

      toast({ title: 'Quote created', description: 'Redirecting to quote detail' });
      navigate(`/quotes/${quote.id}`);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold">New Quote</h1>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-lg">Customer</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Customer Name *</Label>
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
            <Label>Customer Contact</Label>
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
            <Label>Customer Email</Label>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Customer email" />
          </div>
          <div>
            <Label>Customer RFQ #</Label>
            <Input value={customerRfqNumber} onChange={(e) => setCustomerRfqNumber(e.target.value)} placeholder="Customer RFQ number" />
          </div>
          <div>
            <Label>Sales Rep</Label>
            <Input value={salesRepName} onChange={(e) => setSalesRepName(e.target.value)} placeholder="Sales rep name" />
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-lg">CAD Files</h2>
        <label className="border-2 border-dashed border-slate-300 rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:border-slate-400 transition">
          <Upload className="w-8 h-8 text-slate-400 mb-2" />
          <span className="text-sm text-slate-500">Click to upload STEP, IGES, or BREP files</span>
          <span className="text-xs text-slate-400 mt-1">.step, .stp, .iges, .igs, .brep</span>
          <input type="file" multiple accept=".step,.stp,.iges,.igs,.brep" className="hidden" onChange={handleFileUpload} disabled={uploading} />
        </label>
        {uploading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
                <span className="text-sm font-medium truncate">{f.name}</span>
                <Button variant="ghost" size="sm" onClick={() => removeFile(i)}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-lg">Sales Terms</h2>
        <Textarea value={salesTerms} onChange={(e) => setSalesTerms(e.target.value)} placeholder="Payment terms, delivery terms, validity, etc." rows={3} />
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-lg">General Note</h2>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes or requirements..." rows={4} />
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/')}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Create Quote
        </Button>
      </div>
    </div>
  );
}
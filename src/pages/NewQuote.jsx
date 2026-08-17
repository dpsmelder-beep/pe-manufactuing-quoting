import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PROJECT_TYPES } from '@/lib/constants';
import { Upload, ArrowLeft, Loader2 } from 'lucide-react';

export default function NewQuote() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', company: '', email: '', phone: '' });

  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState('cnc_machining');
  const [leadTime, setLeadTime] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Customer.list('-created_date', 100).then(setCustomers).catch(() => {});
  }, []);

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
    if (!projectName) {
      toast({ title: 'Missing info', description: 'Project name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let customerId = selectedCustomerId;
      let customerName = '';
      let customerEmail = '';

      if (showNewCustomer) {
        if (!newCustomer.name || !newCustomer.email) {
          toast({ title: 'Missing info', description: 'Customer name and email required', variant: 'destructive' });
          setSaving(false);
          return;
        }
        const created = await base44.entities.Customer.create(newCustomer);
        customerId = created.id;
        customerName = created.name;
        customerEmail = created.email;
      } else {
        const c = customers.find((c) => c.id === selectedCustomerId);
        if (!c) {
          toast({ title: 'Select customer', description: 'Please select a customer', variant: 'destructive' });
          setSaving(false);
          return;
        }
        customerName = c.name;
        customerEmail = c.email;
      }

      const quoteNumber = `Q-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${String(Date.now()).slice(-4)}`;

      const quote = await base44.entities.Quote.create({
        quote_number: quoteNumber,
        project_name: projectName,
        project_type: projectType,
        customer_id: customerId,
        customer_name: customerName,
        customer_email: customerEmail,
        files,
        lead_time_days: leadTime ? parseInt(leadTime) : 0,
        notes,
        status: 'new',
        line_items: [],
        labor_hours: 0,
        labor_rate: 0,
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
        {!showNewCustomer ? (
          <div className="space-y-3">
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select existing customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} - {c.company || 'No company'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setShowNewCustomer(true)}>
              + Add New Customer
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact Name *</Label>
                <Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              </div>
              <div>
                <Label>Company</Label>
                <Input value={newCustomer.company} onChange={(e) => setNewCustomer({ ...newCustomer, company: e.target.value })} />
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowNewCustomer(false)}>
              Use Existing Customer
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-lg">Project Details</h2>
        <div className="space-y-3">
          <div>
            <Label>Project Name *</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g., Custom Wire Harness Assembly" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Project Type</Label>
              <Select value={projectType} onValueChange={setProjectType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_TYPES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Lead Time (days)</Label>
              <Input type="number" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="e.g., 14" />
            </div>
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
        <h2 className="font-semibold text-lg">Notes</h2>
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
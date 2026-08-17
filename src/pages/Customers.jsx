import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Mail, Phone, Building2, User } from 'lucide-react';

export default function Customers() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', address: '' });

  const load = async () => {
    try {
      const data = await base44.entities.Customer.list('-created_date', 100);
      setCustomers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.name || !form.email) {
      toast({ title: 'Missing info', description: 'Name and email required', variant: 'destructive' });
      return;
    }
    try {
      await base44.entities.Customer.create(form);
      toast({ title: 'Customer added' });
      setForm({ name: '', company: '', email: '', phone: '', address: '' });
      setOpen(false);
      load();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Add Customer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Contact Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Company</Label>
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <Button onClick={handleAdd} className="w-full">Add Customer</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {customers.map((c) => (
          <Card key={c.id} className="p-4 space-y-2">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{c.name}</p>
                {c.company && <p className="text-sm text-slate-500 flex items-center gap-1"><Building2 className="w-3 h-3 shrink-0" /> {c.company}</p>}
              </div>
            </div>
            <div className="space-y-1 text-sm text-slate-600">
              <p className="flex items-center gap-2 truncate"><Mail className="w-3 h-3 shrink-0" /> {c.email}</p>
              {c.phone && <p className="flex items-center gap-2"><Phone className="w-3 h-3 shrink-0" /> {c.phone}</p>}
            </div>
          </Card>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
        </div>
      )}

      {!loading && customers.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <User className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>No customers yet. Add your first customer to get started.</p>
        </div>
      )}
    </div>
  );
}
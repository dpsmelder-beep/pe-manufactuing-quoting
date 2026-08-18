import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';

export default function LineItemsTable({ items, onChange }) {
  const update = (index, field, value) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };

  const add = () => onChange([...items, { part_number: '', quantity: 1, price: 0, notes: '' }]);
  const remove = (index) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="space-y-2 p-3 rounded-lg bg-slate-50">
          <div className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-5">
              <Label className="text-xs">Part Number</Label>
              <Input
                placeholder="Part number"
                value={item.part_number || ''}
                onChange={(e) => update(i, 'part_number', e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Qty</Label>
              <Input
                type="number"
                value={item.quantity || 0}
                onChange={(e) => update(i, 'quantity', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Price</Label>
              <Input
                type="number"
                value={item.price || 0}
                onChange={(e) => update(i, 'price', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="col-span-2 text-right">
              <Label className="text-xs">Total</Label>
              <div className="text-sm font-medium pt-2">
                ${((item.quantity || 0) * (item.price || 0)).toFixed(2)}
              </div>
            </div>
            <div className="col-span-1 flex justify-end pt-5">
              <Button variant="ghost" size="sm" className="px-1" onClick={() => remove(i)}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          </div>
          <Input
            placeholder="Line item notes"
            value={item.notes || ''}
            onChange={(e) => update(i, 'notes', e.target.value)}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="w-4 h-4 mr-1" /> Add Line Item
      </Button>
    </div>
  );
}
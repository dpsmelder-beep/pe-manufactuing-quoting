import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

export default function LineItemsTable({ items, onChange }) {
  const update = (index, field, value) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };

  const add = () => onChange([...items, { description: '', quantity: 1, unit_price: 0 }]);
  const remove = (index) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <Input
            className="col-span-5"
            placeholder="Description"
            value={item.description || ''}
            onChange={(e) => update(i, 'description', e.target.value)}
          />
          <Input
            className="col-span-2"
            type="number"
            placeholder="Qty"
            value={item.quantity || 0}
            onChange={(e) => update(i, 'quantity', parseFloat(e.target.value) || 0)}
          />
          <Input
            className="col-span-2"
            type="number"
            placeholder="Unit $"
            value={item.unit_price || 0}
            onChange={(e) => update(i, 'unit_price', parseFloat(e.target.value) || 0)}
          />
          <div className="col-span-2 text-right text-sm font-medium text-slate-700">
            ${((item.quantity || 0) * (item.unit_price || 0)).toFixed(2)}
          </div>
          <Button variant="ghost" size="sm" className="col-span-1 px-1" onClick={() => remove(i)}>
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="w-4 h-4 mr-1" /> Add Line Item
      </Button>
    </div>
  );
}
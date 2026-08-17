import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import { PROJECT_TYPES, PROJECT_TYPE_COLORS, STATUSES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Plus, FileText, DollarSign, Clock, TrendingUp } from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await base44.entities.Quote.list('-created_date', 200);
        setQuotes(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = statusFilter === 'all' ? quotes : quotes.filter((q) => q.status === statusFilter);

  const stats = {
    total: quotes.length,
    newCount: quotes.filter((q) => q.status === 'new').length,
    inReview: quotes.filter((q) => q.status === 'in_review').length,
    sent: quotes.filter((q) => q.status === 'sent').length,
    totalValue: quotes.reduce((sum, q) => sum + (q.total || 0), 0),
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Quotes Dashboard</h1>
        <Button onClick={() => navigate('/quotes/new')}>
          <Plus className="w-4 h-4 mr-2" />
          New Quote
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Quotes</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-50 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">In Review</p>
              <p className="text-xl font-bold">{stats.inReview}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Sent</p>
              <p className="text-xl font-bold">{stats.sent}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Value</p>
              <p className="text-xl font-bold">${stats.totalValue.toLocaleString()}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm font-medium transition',
            statusFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          )}
        >
          All ({quotes.length})
        </button>
        {Object.entries(STATUSES).map(([key, config]) => {
          const count = quotes.filter((q) => q.status === key).length;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition',
                statusFilter === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              )}
            >
              {config.label} ({count})
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-500">Quote #</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-500">Project</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-500">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-500">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-500">Status</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-slate-500">Total</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-500 hidden md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr
                  key={q.id}
                  onClick={() => navigate(`/quotes/${q.id}`)}
                  className="border-b hover:bg-slate-50 cursor-pointer transition"
                >
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">{q.quote_number}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{q.project_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{q.customer_name}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', PROJECT_TYPE_COLORS[q.project_type])}>
                      {PROJECT_TYPES[q.project_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                  <td className="px-4 py-3 text-sm font-medium text-right">${(q.total || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 hidden md:table-cell">
                    {q.created_date ? format(new Date(q.created_date), 'MMM d, yyyy') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && !loading && (
          <div className="text-center py-12 text-slate-500">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>No quotes found. Create a new quote to get started.</p>
          </div>
        )}
        {loading && (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto" />
          </div>
        )}
      </Card>
    </div>
  );
}
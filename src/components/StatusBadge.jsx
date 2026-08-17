import React from 'react';
import { STATUSES } from '@/lib/constants';
import { cn } from '@/lib/utils';

export default function StatusBadge({ status }) {
  const config = STATUSES[status] || STATUSES.new;
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', config.badgeClass)}>
      {config.label}
    </span>
  );
}
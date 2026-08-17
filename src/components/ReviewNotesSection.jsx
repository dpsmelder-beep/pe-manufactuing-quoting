import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { MessageSquare } from 'lucide-react';

export default function ReviewNotesSection({ notes, onAdd }) {
  const [text, setText] = useState('');

  const handleAdd = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {notes.length === 0 ? (
          <p className="text-sm text-slate-400">No review notes yet. Add feedback from the technical review below.</p>
        ) : (
          notes.map((note, i) => (
            <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.text}</p>
              <p className="text-xs text-slate-400 mt-1">
                {note.author} {note.date ? `• ${format(new Date(note.date), 'MMM d, yyyy h:mm a')}` : ''}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 items-end">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a review note for the team..."
          rows={2}
          className="flex-1"
        />
        <Button onClick={handleAdd} className="self-end">
          <MessageSquare className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}
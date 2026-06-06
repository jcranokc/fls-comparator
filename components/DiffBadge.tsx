import { h } from 'preact';
import type { DiffStatus } from '../lib/api/types';

interface DiffBadgeProps {
  status: DiffStatus;
  value?: boolean;
  label?: string;
}

const statusStyles: Record<DiffStatus, { bg: string; text: string; border: string; label: string }> = {
  MATCH: {
    bg: 'bg-teal-400/10',
    text: 'text-teal-400',
    border: 'border-teal-400/30',
    label: 'Match',
  },
  READ_DIFFERS: {
    bg: 'bg-amber-400/10',
    text: 'text-amber-400',
    border: 'border-amber-400/30',
    label: 'Read Differs',
  },
  EDIT_DIFFERS: {
    bg: 'bg-amber-400/10',
    text: 'text-amber-400',
    border: 'border-amber-400/30',
    label: 'Edit Differs',
  },
  BOTH_DIFFER: {
    bg: 'bg-rose-400/10',
    text: 'text-rose-400',
    border: 'border-rose-400/30',
    label: 'Both Differ',
  },
  MISSING_IN_TARGET: {
    bg: 'bg-rose-400/10',
    text: 'text-rose-400',
    border: 'border-dashed border-rose-400/50',
    label: 'Missing in Target',
  },
  NEW_IN_TARGET: {
    bg: 'bg-cyan-400/10',
    text: 'text-cyan-400',
    border: 'border-dashed border-cyan-400/50',
    label: 'New in Target',
  },
};

function CheckIcon() {
  return (
    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function DiffBadge({ status, value, label }: DiffBadgeProps) {
  const style = statusStyles[status];
  const displayLabel = label ?? style.label;

  return (
    <span
      class={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border
              ${style.bg} ${style.text} ${style.border}
              transition-all duration-200`}
      title={style.label}
    >
      {value !== undefined && (
        <span class="flex-shrink-0">
          {value ? <CheckIcon /> : <XIcon />}
        </span>
      )}
      {displayLabel}
    </span>
  );
}

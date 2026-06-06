import { h } from 'preact';

type EmptyStateType = 'no-salesforce' | 'no-snapshots' | 'no-results' | 'no-field-selected';

interface EmptyStateProps {
  type: EmptyStateType;
  action?: { label: string; onClick: () => void };
}

const config: Record<EmptyStateType, { title: string; description: string }> = {
  'no-salesforce': {
    title: 'Not on a Salesforce page',
    description: 'Navigate to a Salesforce Setup page to get started',
  },
  'no-snapshots': {
    title: 'No snapshots yet',
    description: 'Capture your first FLS snapshot to compare fields',
  },
  'no-results': {
    title: 'No matching results',
    description: 'Try adjusting your search or filters',
  },
  'no-field-selected': {
    title: 'Select a field',
    description: 'Choose an object and field above to view FLS',
  },
};

function ShieldIcon() {
  return (
    <svg class="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg class="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg class="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg class="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
    </svg>
  );
}

const icons: Record<EmptyStateType, () => h.JSX.Element> = {
  'no-salesforce': ShieldIcon,
  'no-snapshots': CameraIcon,
  'no-results': SearchIcon,
  'no-field-selected': CursorIcon,
};

export function EmptyState({ type, action }: EmptyStateProps) {
  const { title, description } = config[type];
  const Icon = icons[type];

  return (
    <div class="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div class="mb-4 p-4 rounded-2xl bg-slate-800/60 border border-slate-700/40">
        <Icon />
      </div>
      <h3 class="text-lg font-semibold text-slate-100 mb-1">{title}</h3>
      <p class="text-sm text-slate-400 max-w-xs mb-5">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md
                 bg-cyan-500/15 text-cyan-400 border border-cyan-500/30
                 hover:bg-cyan-500/25 hover:border-cyan-500/50
                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40
                 transition-all duration-200"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

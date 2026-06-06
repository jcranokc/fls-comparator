import { h } from 'preact';

interface LoadingSkeletonProps {
  lines?: number;
  type?: 'table' | 'card' | 'picker';
}

function SkeletonBar({ width = '100%', height = 'h-4' }: { width?: string; height?: string }) {
  return (
    <div
      class={`${height} rounded-md bg-slate-700/60 animate-pulse`}
      style={{ width }}
    />
  );
}

function TableSkeleton({ lines }: { lines: number }) {
  const widths = ['75%', '60%', '90%', '45%', '80%', '55%', '70%', '85%'];
  return (
    <div class="space-y-1">
      {/* Header row */}
      <div class="flex items-center gap-4 px-4 py-3 border-b border-slate-700/50">
        <SkeletonBar width="30%" height="h-3" />
        <SkeletonBar width="15%" height="h-3" />
        <SkeletonBar width="10%" height="h-3" />
        <SkeletonBar width="10%" height="h-3" />
      </div>
      {/* Data rows */}
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          class="flex items-center gap-4 px-4 py-3"
          style={{ animationDelay: `${i * 75}ms` }}
        >
          <SkeletonBar width={widths[i % widths.length]} height="h-3.5" />
          <SkeletonBar width="12%" height="h-3" />
          <SkeletonBar width="8%" height="h-5" />
          <SkeletonBar width="8%" height="h-5" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton({ lines }: { lines: number }) {
  return (
    <div class="grid gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          class="bg-slate-800/60 rounded-lg p-4 border border-slate-700/40 animate-pulse"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div class="flex items-start gap-3">
            {/* Avatar / icon placeholder */}
            <div class="w-10 h-10 rounded-lg bg-slate-700/60 flex-shrink-0" />
            <div class="flex-1 space-y-2.5">
              <SkeletonBar width="60%" height="h-4" />
              <SkeletonBar width="40%" height="h-3" />
              <SkeletonBar width="80%" height="h-3" />
            </div>
          </div>
          {/* Action buttons */}
          <div class="flex gap-2 mt-4 pt-3 border-t border-slate-700/30">
            <SkeletonBar width="20%" height="h-7" />
            <SkeletonBar width="20%" height="h-7" />
            <SkeletonBar width="20%" height="h-7" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PickerSkeleton({ lines }: { lines: number }) {
  return (
    <div class="space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} class="space-y-1.5" style={{ animationDelay: `${i * 120}ms` }}>
          {/* Label */}
          <SkeletonBar width="25%" height="h-3" />
          {/* Dropdown */}
          <div class="flex items-center gap-2 animate-pulse">
            <div class="flex-1 h-10 rounded-md bg-slate-700/60 border border-slate-700/40" />
            <div class="w-8 h-8 rounded-md bg-slate-700/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadingSkeleton({ lines = 5, type = 'table' }: LoadingSkeletonProps) {
  return (
    <div class="w-full" role="status" aria-label="Loading...">
      {type === 'table' && <TableSkeleton lines={lines} />}
      {type === 'card' && <CardSkeleton lines={lines} />}
      {type === 'picker' && <PickerSkeleton lines={lines} />}
      <span class="sr-only">Loading…</span>
    </div>
  );
}

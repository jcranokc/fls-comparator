import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import type { SalesforceSession } from '../lib/api/types';
import { describeObjects, describeFields } from '../lib/api/salesforce';
import { getSession } from '../lib/api/session';
import { LoadingSkeleton } from './LoadingSkeleton';

interface FieldPickerProps {
  onFieldSelect: (objectName: string, fieldName: string) => void;
  disabled?: boolean;
}

interface ObjectItem {
  name: string;
  label: string;
  custom: boolean;
}

interface FieldItem {
  name: string;
  label: string;
  type: string;
  custom: boolean;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Use a short timeout to let the dropdown finish rendering before stealing focus
    const id = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(id);
  }, []);

  return (
    <div class="relative px-2 pt-2 pb-1 sticky top-0 bg-slate-800 z-10">
      <svg class="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
        class="w-full pl-7 pr-3 py-1.5 text-xs rounded-md bg-slate-700/50 border border-slate-600/50
               text-slate-200 placeholder-slate-500
               focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50
               transition-all duration-200"
      />
    </div>
  );
}

function ChevronDown() {
  return (
    <svg class="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

export function FieldPicker({ onFieldSelect, disabled = false }: FieldPickerProps) {
  const [session, setSession] = useState<SalesforceSession | null>(null);
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [fields, setFields] = useState<FieldItem[]>([]);
  const [selectedObject, setSelectedObject] = useState('');
  const [selectedField, setSelectedField] = useState('');
  const [objectSearch, setObjectSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [objectDropdownOpen, setObjectDropdownOpen] = useState(false);
  const [fieldDropdownOpen, setFieldDropdownOpen] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const objectDropdownRef = useRef<HTMLDivElement>(null);
  const fieldDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (objectDropdownRef.current && !objectDropdownRef.current.contains(e.target as Node)) {
        setObjectDropdownOpen(false);
      }
      if (fieldDropdownRef.current && !fieldDropdownRef.current.contains(e.target as Node)) {
        setFieldDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch session and objects on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingObjects(true);
        const sess = await getSession();
        if (cancelled) return;
        if (!sess) {
          setError('No active Salesforce session');
          setLoadingObjects(false);
          return;
        }
        setSession(sess);
        const objs = await describeObjects(sess);
        if (!cancelled) {
          setObjects(objs);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load objects');
      } finally {
        if (!cancelled) setLoadingObjects(false);
      }
    })();
    return () => { cancelled = true; };
  }, [retryKey]);

  // Fetch fields when object changes
  useEffect(() => {
    if (!selectedObject || !session) {
      setFields([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoadingFields(true);
        setFields([]);
        setSelectedField('');
        setFieldSearch('');
        const flds = await describeFields(session, selectedObject);
        if (!cancelled) {
          setFields(flds);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load fields');
      } finally {
        if (!cancelled) setLoadingFields(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedObject, session]);

  const filteredObjects = useMemo(() => {
    if (!objectSearch) return objects;
    const q = objectSearch.toLowerCase();
    return objects.filter(o => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
  }, [objects, objectSearch]);

  const filteredFields = useMemo(() => {
    if (!fieldSearch) return fields;
    const q = fieldSearch.toLowerCase();
    return fields.filter(f => f.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
  }, [fields, fieldSearch]);

  const handleObjectSelect = useCallback((name: string) => {
    setSelectedObject(name);
    setObjectDropdownOpen(false);
    setObjectSearch('');
  }, []);

  const handleFieldSelect = useCallback((name: string) => {
    setSelectedField(name);
    setFieldDropdownOpen(false);
    setFieldSearch('');
    onFieldSelect(selectedObject, name);
  }, [selectedObject, onFieldSelect]);

  const selectedObjectLabel = objects.find(o => o.name === selectedObject);
  const selectedFieldLabel = fields.find(f => f.name === selectedField);

  if (loadingObjects && objects.length === 0) {
    return (
      <div class="space-y-3">
        <LoadingSkeleton type="picker" lines={2} />
      </div>
    );
  }

  return (
    <div class={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {error && (
        <div class="flex items-center gap-2 px-3 py-2 rounded-md bg-rose-400/10 border border-rose-400/20 text-rose-400 text-xs">
          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span class="flex-1">{error}</span>
          <button
            onClick={() => { setError(''); setRetryKey(k => k + 1); }}
            class="underline hover:no-underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Object Dropdown */}
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-slate-400 uppercase tracking-wider">Object</label>
          {objects.length > 0 && (
            <span class="text-xs text-slate-500">{objects.length} objects</span>
          )}
        </div>
        <div ref={objectDropdownRef} class="relative">
          <button
            type="button"
            onClick={() => setObjectDropdownOpen(!objectDropdownOpen)}
            disabled={disabled || objects.length === 0}
            class="w-full flex items-center justify-between px-3 py-2.5 rounded-md
                   bg-slate-800 border border-slate-700 text-sm text-left
                   hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all duration-200"
          >
            <span class={selectedObjectLabel ? 'text-slate-100' : 'text-slate-500'}>
              {selectedObjectLabel ? `${selectedObjectLabel.label} (${selectedObjectLabel.name})` : 'Select an object…'}
            </span>
            <ChevronDown />
          </button>

          {objectDropdownOpen && (
            <div class="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-md
                        bg-slate-800 border border-slate-700 shadow-xl shadow-black/30">
              <SearchInput
                value={objectSearch}
                onChange={setObjectSearch}
                placeholder="Search objects…"
              />
              <div class="py-1">
                {filteredObjects.length === 0 ? (
                  <div class="px-3 py-4 text-xs text-slate-500 text-center">No objects match</div>
                ) : (
                  filteredObjects.map(obj => (
                    <button
                      key={obj.name}
                      type="button"
                      onClick={() => handleObjectSelect(obj.name)}
                      class={`w-full text-left px-3 py-2 text-sm flex items-center justify-between
                             hover:bg-slate-700/60 transition-colors duration-150
                             ${obj.name === selectedObject ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-200'}`}
                    >
                      <span class="truncate">
                        {obj.label}
                        <span class="ml-1.5 text-xs text-slate-500">{obj.name}</span>
                      </span>
                      {obj.custom && (
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 ml-2 flex-shrink-0">
                          Custom
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Field Dropdown */}
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-slate-400 uppercase tracking-wider">Field</label>
          {fields.length > 0 && (
            <span class="text-xs text-slate-500">{fields.length} fields</span>
          )}
        </div>
        <div ref={fieldDropdownRef} class="relative">
          <button
            type="button"
            onClick={() => selectedObject && setFieldDropdownOpen(!fieldDropdownOpen)}
            disabled={disabled || !selectedObject || loadingFields}
            class="w-full flex items-center justify-between px-3 py-2.5 rounded-md
                   bg-slate-800 border border-slate-700 text-sm text-left
                   hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all duration-200"
          >
            {loadingFields ? (
              <span class="text-slate-500 flex items-center gap-2">
                <svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading fields…
              </span>
            ) : (
              <span class={selectedFieldLabel ? 'text-slate-100' : 'text-slate-500'}>
                {selectedFieldLabel ? `${selectedFieldLabel.label} (${selectedFieldLabel.name})` : 'Select a field…'}
              </span>
            )}
            <ChevronDown />
          </button>

          {fieldDropdownOpen && (
            <div class="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-md
                        bg-slate-800 border border-slate-700 shadow-xl shadow-black/30">
              <SearchInput
                value={fieldSearch}
                onChange={setFieldSearch}
                placeholder="Search fields…"
              />
              <div class="py-1">
                {filteredFields.length === 0 ? (
                  <div class="px-3 py-4 text-xs text-slate-500 text-center">No fields match</div>
                ) : (
                  filteredFields.map(field => (
                    <button
                      key={field.name}
                      type="button"
                      onClick={() => handleFieldSelect(field.name)}
                      class={`w-full text-left px-3 py-2 text-sm flex items-center justify-between
                             hover:bg-slate-700/60 transition-colors duration-150
                             ${field.name === selectedField ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-200'}`}
                    >
                      <span class="truncate">
                        {field.label}
                        <span class="ml-1.5 text-xs text-slate-500">{field.name}</span>
                      </span>
                      <span class="flex items-center gap-1.5 ml-2 flex-shrink-0">
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                          {field.type}
                        </span>
                        {field.custom && (
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                            Custom
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

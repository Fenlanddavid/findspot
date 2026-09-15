import type { DetectorContext } from '../services/collectionModels';
export function DetectorContextFields({ value, onChange }: { value: DetectorContext; onChange: (context: DetectorContext) => void }) {
  return <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-2">Recorded equipment and conditions (optional)</summary><div className="mt-3 space-y-3">
    {(['coilLabel', 'programmeLabel', 'frequencyLabel'] as const).map(field => <label key={field} className="block">{{ coilLabel: 'Coil', programmeLabel: 'Programme', frequencyLabel: 'Frequency' }[field]}<input className="ui-input w-full" maxLength={100} value={value[field] ?? ''} onChange={e => onChange({ ...value, [field]: e.target.value })} /></label>)}
    <label className="block">Recorded ground condition<select className="ui-input w-full" value={value.groundCondition ?? ''} onChange={e => onChange({ ...value, groundCondition: e.target.value as DetectorContext['groundCondition'] || undefined })}><option value="">Not recorded</option>{['dry', 'damp', 'wet', 'mixed', 'unknown'].map(option => <option key={option}>{option}</option>)}</select></label>
    <label className="block">Ground notes (private)<textarea className="ui-input w-full" maxLength={1000} value={value.groundNotes ?? ''} onChange={e => onChange({ ...value, groundNotes: e.target.value })} /></label>
  </div></details>;
}

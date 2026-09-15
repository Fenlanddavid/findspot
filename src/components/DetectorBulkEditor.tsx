import { useState } from 'react';
import type { Find } from '../db';
import type { DetectorReferenceGroup, DetectorContext } from '../services/collectionModels';
import { applyDetectorBulkChange, type DetectorBulkChange } from '../services/detectorReferenceGroups';
import { Modal } from './Modal';
import { DetectorContextFields } from './DetectorContextFields';

export function DetectorBulkEditor({ projectId, finds, groups, onClose }: { projectId: string; finds: Find[]; groups: DetectorReferenceGroup[]; onClose: () => void }) {
  const [detector, setDetector] = useState(''); const [group, setGroup] = useState(''); const [context, setContext] = useState<DetectorContext>({});
  const [preview, setPreview] = useState<{ change: DetectorBulkChange; expected: Array<{ id: string; signature: string }> }>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="Update selected detector details" onClose={onClose}><div className="space-y-4">
    <p>{finds.length} selected records. Target IDs will remain as recorded.</p>
    {!preview ? <><label className="block">Assign recorded detector name (optional)<input className="ui-input w-full" maxLength={200} value={detector} onChange={e => setDetector(e.target.value)} /></label>
      <label className="block">Reference group<select className="ui-input w-full" value={group} onChange={e => setGroup(e.target.value)}><option value="">Keep existing assignment</option><option value="__alias">Use name aliases / remove explicit assignment</option>{groups.map(row => <option value={row.id} key={row.id}>{row.displayName}</option>)}</select></label>
      <DetectorContextFields value={context} onChange={setContext} />
      <p className="text-sm">Only edited context fields will replace existing values. Empty edited fields clear their previous value.</p>
      <button className="ui-primary" disabled={!detector.trim() && !group && !Object.keys(context).length} onClick={() => setPreview({ change: { ...(detector.trim() ? { detector: detector.trim() } : {}), ...(group ? { groupId: group === '__alias' ? null : group } : {}), ...(Object.keys(context).length ? { context } : {}) }, expected: finds.map(find => ({ id: find.id, signature: JSON.stringify(find) })) })}>Preview replacements</button></> : <>
      <h2 className="text-xl">Confirm these replacements</h2>
      {finds.map(find => <div key={find.id} className="rounded-xl border p-3"><h3 className="font-bold">{find.objectType || 'Unidentified find'}</h3>{preview.change.detector && <p>Detector: {find.detector || 'Unknown'} → {preview.change.detector}</p>}{preview.change.groupId !== undefined && <p>Reference assignment → {groups.find(row => row.id === preview.change.groupId)?.displayName ?? 'Resolve from recorded detector name'}</p>}{Object.entries(preview.change.context ?? {}).map(([key, value]) => <p key={key}>{{ coilLabel: 'Coil', programmeLabel: 'Programme', frequencyLabel: 'Frequency', groundCondition: 'Ground condition', groundNotes: 'Ground notes' }[key]}: {find.detectorContext?.[key as keyof DetectorContext] || 'Not recorded'} → {value || 'Not recorded'}</p>)}</div>)}
      <button className="ui-primary" disabled={busy} onClick={async () => { setBusy(true); try { await applyDetectorBulkChange(projectId, preview.expected, preview.change); onClose(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>Confirm changes to {finds.length} records</button><button className="ui-secondary ml-2" disabled={busy} onClick={() => setPreview(undefined)}>Back to editing</button>
    </>}{error && <p role="alert">{error}</p>}
  </div></Modal>;
}

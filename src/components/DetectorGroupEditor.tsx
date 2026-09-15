import { useState } from 'react';
import { Modal } from './Modal';
import { saveDetectorGroup, deleteDetectorGroup } from '../services/detectorReferenceGroups';
import { normalizeDetectorName, type DetectorReferenceGroup, type DetectorReferenceAlias } from '../services/collectionModels';
import { useConfirmDialog } from './ConfirmModal';

export function DetectorGroupEditor({ projectId, names, group, aliases, onClose }: { projectId: string; names: string[]; group?: DetectorReferenceGroup; aliases: DetectorReferenceAlias[]; onClose: () => void }) {
  const [title, setTitle] = useState(group?.displayName ?? ''); const [model, setModel] = useState(group?.detectorModel ?? '');
  const [selected, setSelected] = useState(aliases.filter(alias => alias.groupId === group?.id).map(alias => alias.sourceDetectorName));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const { confirm, dialog } = useConfirmDialog();
  const options = [...new Set([...selected, ...names])];
  return <Modal title={group ? 'Edit detector group' : 'Create detector group'} onClose={onClose}>{dialog}<div className="space-y-4">
    <p>Only combine names you know refer to compatible target-ID scales. To separate finds with the same recorded name, create a group here, then select those finds and assign them explicitly.</p>
    <label className="block">Group name<input className="ui-input w-full" maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label className="block">Model or scale description (optional)<input className="ui-input w-full" maxLength={100} value={model} onChange={e => setModel(e.target.value)} /></label>
    <fieldset><legend>Historical names belonging to this group</legend>{options.map(name => {
      const alias = aliases.find(row => row.normalizedName === normalizeDetectorName(name)); const taken = !!alias && alias.groupId !== group?.id;
      return <label key={name} className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={taken || busy} checked={selected.some(value => normalizeDetectorName(value) === normalizeDetectorName(name))} onChange={e => setSelected(e.target.checked ? [...selected, name] : selected.filter(value => normalizeDetectorName(value) !== normalizeDetectorName(name)))} />{name}{taken && ' (already grouped)'}</label>;
    })}</fieldset>
    <p className="text-sm">Unchecking a name removes its alias. Original detector names and readings are preserved.</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || !title.trim()} className="ui-primary" onClick={async () => { setBusy(true); try { const now = new Date().toISOString(); await saveDetectorGroup({ id: group?.id ?? crypto.randomUUID(), projectId, displayName: title.trim(), detectorModel: model || undefined, createdAt: group?.createdAt ?? now, updatedAt: now }, selected); onClose(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>Save grouping</button>
    {group && <button disabled={busy} className="ui-secondary ml-2" onClick={async () => { if (await confirm({ title: 'Remove detector group?', message: 'Aliases and explicit assignments will be removed. Your finds and recorded detector names remain saved.', confirmLabel: 'Remove group', danger: true })) { setBusy(true); try { await deleteDetectorGroup(group.id); onClose(); } catch (error) { setError(String(error)); } finally { setBusy(false); } } }}>Remove group</button>}
  </div></Modal>;
}

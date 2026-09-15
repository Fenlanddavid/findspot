import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePersistence } from '../services/pagePersistence';
import { Modal } from './Modal';
import { FindPhoto } from './FindPhoto';

export function CollectionFindPicker({ projectId, selected, onApply, onClose, replacement }: { projectId: string; selected: string[]; onApply: (ids: string[]) => void; onClose: () => void; replacement?: { excludedFindIds: string[] } }) {
  const [ids, setIds] = useState(selected);
  const [query, setQuery] = useState(''); const [permission, setPermission] = useState(''); const [material, setMaterial] = useState(''); const [period, setPeriod] = useState(''); const [limit, setLimit] = useState(40);
  const finds = useLiveQuery(() => pagePersistence.finds.where('projectId').equals(projectId).toArray(), [projectId]);
  const permissions = useLiveQuery(() => pagePersistence.permissions.where('projectId').equals(projectId).toArray(), [projectId]);
  const results = (finds ?? []).filter(find => !replacement?.excludedFindIds.includes(find.id) && (!permission || find.permissionId === permission) && (!material || find.material === material) && (!period || find.period === period) && [find.objectType, find.findCode, find.material, find.period, find.findCategory].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <Modal title={replacement ? 'Relink collection item' : 'Choose collection finds'} onClose={onClose}>
    <div className="space-y-3">
      <p role="status">{replacement ? 'Choose one replacement find. Your title and caption stay saved. Choose photographs and review the source again after relinking.' : `${ids.length} selected · up to 50 finds`}</p>
      <label className="block">Search<input className="ui-input w-full" value={query} onChange={e => { setQuery(e.target.value); setLimit(40); }} /></label>
      <label className="block">Permission<select className="ui-input w-full" value={permission} onChange={e => setPermission(e.target.value)}><option value="">All permissions</option>{permissions?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2">{(['material', 'period'] as const).map(field => <label key={field}>{field === 'material' ? 'Material' : 'Recorded period'}<select className="ui-input w-full" value={field === 'material' ? material : period} onChange={e => field === 'material' ? setMaterial(e.target.value) : setPeriod(e.target.value)}><option value="">All</option>{[...new Set(finds?.map(find => find[field]))].sort().map(value => <option key={value} value={value}>{value || 'Unknown'}</option>)}</select></label>)}</div>
      <div className="grid grid-cols-2 gap-3">{results.slice(Math.max(0, limit - 40), limit).map(find => <label key={find.id} className="rounded-xl border p-2">
        <FindPhoto projectId={projectId} findId={find.id} className="h-28 rounded-lg" />
        <span className="flex min-h-11 items-center gap-2"><input type={replacement ? 'radio' : 'checkbox'} name={replacement ? 'replacement-find' : undefined} checked={ids.includes(find.id)} disabled={!ids.includes(find.id) && ids.length >= 50} onChange={e => setIds(previous => e.target.checked ? replacement ? [find.id] : [...previous, find.id] : previous.filter(id => id !== find.id))} />{find.objectType || 'Unidentified find'}</span>
        <span className="text-sm">{find.period || 'Unknown period'}</span>
      </label>)}</div>
      <div className="flex gap-3">{limit > 40 && <button className="ui-secondary" onClick={() => setLimit(limit - 40)}>Previous finds</button>}{results.length > limit && <button className="ui-secondary" onClick={() => setLimit(limit + 40)}>Next finds</button>}</div>
      {!results.length && <p>No matching finds.</p>}
      <button className="ui-primary" disabled={!!replacement && ids.length !== 1} onClick={() => { onApply(ids); onClose(); }}>{replacement ? 'Relink to selected find' : `Use ${ids.length} selected finds`}</button>
    </div>
  </Modal>;
}

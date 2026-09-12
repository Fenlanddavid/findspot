import { FIELDGUIDE_SHORT_NOTICE } from '../../utils/legalCopy';

export function FieldGuideNotice() {
    return <details className="px-1 text-xs text-slate-400">
        <summary className="block min-h-11 cursor-pointer content-center text-center">ⓘ FieldGuide™ · About</summary>
        <p className="pb-2 text-sm leading-relaxed">{FIELDGUIDE_SHORT_NOTICE}</p>
    </details>;
}

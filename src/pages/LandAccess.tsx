import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  LAND_ACCESS_AGREEMENT_FILENAME,
  LAND_ACCESS_AGREEMENT_TEMPLATE,
  LAND_ACCESS_GUIDANCE_VERSION,
  LAND_ACCESS_SECTIONS,
} from '../content/landAccessGuidance';

const RESPONSIBLE_DETECTING_URL = 'https://finds.org.uk/getinvolved/guides/codeofpractice';
const LAND_REGISTRY_URL = 'https://www.gov.uk/search-property-information-land-registry';
const TREASURE_URL = 'https://www.gov.uk/treasure';

export default function LandAccess() {
  const navigate = useNavigate();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyAgreement() {
    try {
      await navigator.clipboard.writeText(LAND_ACCESS_AGREEMENT_TEMPLATE);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  function downloadAgreement() {
    const url = URL.createObjectURL(new Blob([LAND_ACCESS_AGREEMENT_TEMPLATE], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = LAND_ACCESS_AGREEMENT_FILENAME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-emerald-700 dark:text-gray-400 dark:hover:text-emerald-300"
      >
        ← Back
      </button>

      <header className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 dark:border-emerald-900 dark:from-emerald-950/40 dark:to-gray-950 sm:p-8">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Land access · England &amp; Wales</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-gray-950 dark:text-white">Ask well. Record the agreement. Earn the next visit.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
          Practical guidance for finding the right person, making a respectful approach and showing what you will give back. This is a reference, not a contact-finding service or a legal service.
        </p>
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-black text-amber-900 dark:text-amber-200">“No” is a complete answer.</p>
          <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">Do not pressure, return through another channel or turn up unannounced at a private home. This guide covers England and Wales; finds law differs elsewhere in the UK.</p>
        </div>
      </header>

      <nav aria-label="Land access guide sections" className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {LAND_ACCESS_SECTIONS.map(section => (
          <a key={section.id} href={`#${section.id}`} className="whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-600 hover:border-emerald-400 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {section.title}
          </a>
        ))}
      </nav>

      <main className="mt-4 space-y-4">
        {LAND_ACCESS_SECTIONS.map((section, index) => (
          <section key={section.id} id={section.id} className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{index + 1} of {LAND_ACCESS_SECTIONS.length}</p>
            <h2 className="mt-1 text-xl font-black text-gray-900 dark:text-white">{section.title}</h2>
            <p className="mt-1 text-sm font-bold text-gray-600 dark:text-gray-300">{section.summary}</p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            </div>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-gray-700 dark:text-gray-200">
              {section.points.map(point => (
                <li key={point} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{point}</li>
              ))}
            </ul>

            {section.id === 'finding-who-to-ask' && (
              <a href={LAND_REGISTRY_URL} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex text-xs font-black text-blue-700 hover:underline dark:text-blue-300">
                Search HM Land Registry yourself →
              </a>
            )}
            {section.id === 'what-to-offer' && (
              <a href={RESPONSIBLE_DETECTING_URL} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex text-xs font-black text-blue-700 hover:underline dark:text-blue-300">
                Responsible detecting code →
              </a>
            )}
          </section>
        ))}

        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30 sm:p-6" aria-labelledby="agreement-template-title">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">Starting template</p>
          <h2 id="agreement-template-title" className="mt-1 text-xl font-black text-gray-900 dark:text-white">Land access agreement</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">Copy or download the plain-text template, then review it together. It includes separate owner and occupier lines. FindSpot does not provide legal advice or decide whether the wording forms a binding agreement.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyAgreement()} className="rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-800">
              Copy template
            </button>
            <button type="button" onClick={downloadAgreement} className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-blue-800 hover:border-blue-500 dark:border-blue-800 dark:bg-gray-900 dark:text-blue-200">
              Download .txt
            </button>
          </div>
          {copyStatus === 'copied' && <p role="status" className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">Template copied.</p>}
          {copyStatus === 'failed' && <p role="status" className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">Copy was unavailable. Use Download instead.</p>}
          <details className="mt-4 rounded-xl border border-blue-200 bg-white p-4 dark:border-blue-900 dark:bg-gray-950/60">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-200">Preview template</summary>
            <pre className="mt-4 whitespace-pre-wrap font-mono text-[11px] leading-5 text-gray-600 dark:text-gray-300">{LAND_ACCESS_AGREEMENT_TEMPLATE}</pre>
          </details>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-900/60 sm:p-6">
          <h2 className="text-lg font-black text-gray-900 dark:text-white">Before detecting starts</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">Written land permission does not override protected-site restrictions or other laws. Potential Treasure in England or Wales must be reported through the statutory process within 14 days.</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-black">
            <a href={TREASURE_URL} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline dark:text-blue-300">Official Treasure guidance →</a>
            <Link to="/permission" className="text-emerald-700 hover:underline dark:text-emerald-300">Create a permission record →</Link>
          </div>
        </section>
      </main>

      <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">Guidance version {LAND_ACCESS_GUIDANCE_VERSION}</p>
    </div>
  );
}

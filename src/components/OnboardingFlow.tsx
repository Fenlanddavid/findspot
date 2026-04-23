// ─── Quick Start onboarding overlay ──────────────────────────────────────────
// Shown only to new users (no existing data + flag not set).
// Self-contained — touching nothing in core workflows.
// Dismiss sets fs_onboarding_done in localStorage; will not appear again.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';

const FLAG = 'fs_onboarding_done';

// Read and consume the force flag at module load time — runs exactly once per
// page load, immune to React StrictMode's double-invocation of effects/inits.
const FORCED_THIS_LOAD = !!localStorage.getItem('fs_onboarding_force');
if (FORCED_THIS_LOAD) localStorage.removeItem('fs_onboarding_force');

type Step = 'welcome' | 'choose' | 'install' | 'finds' | 'fieldguide' | 'permissions' | 'settings' | 'done';

export default function OnboardingFlow() {
    // Fast sync check — avoids any flash for returning users
    const [visible, setVisible]               = useState(() => !localStorage.getItem(FLAG) || FORCED_THIS_LOAD);
    const [step, setStep]                     = useState<Step>('welcome');
    const [pendingDestination, setPending]    = useState('/');
    const nav = useNavigate();

    // Async guard — skip if user already has meaningful data.
    // Bypassed when forced (e.g. "Show Quick Start again" in Settings).
    useEffect(() => {
        if (!visible || FORCED_THIS_LOAD) return;
        Promise.all([db.permissions.count(), db.finds.count()]).then(([p, f]) => {
            if (p > 0 || f > 0) dismiss();
        });
    }, []);

    function markDone() {
        localStorage.setItem(FLAG, '1');
    }

    function dismiss() {
        markDone();
        setVisible(false);
    }

    function go(destination: string) {
        markDone(); // write flag immediately so re-opening app won't show onboarding again
        setPending(destination);
        setStep('done');
    }

    function leave() {
        setVisible(false);
        nav(pendingDestination);
    }


    if (!visible) return null;

    const dots = (active: number) => (
        <div className="flex items-center justify-center gap-2 mb-8">
            {[0, 1, 2].map(i => (
                <div key={i} className={`rounded-full transition-all duration-300 ${i === active ? 'w-5 h-2 bg-emerald-400' : 'w-2 h-2 bg-white/20'}`} />
            ))}
        </div>
    );

    const skipBtn = (
        <button
            onClick={dismiss}
            className="mt-6 text-[11px] text-white/30 hover:text-white/60 transition-colors duration-150 cursor-pointer"
        >
            Skip for now
        </button>
    );

    return (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="w-full sm:max-w-md bg-slate-900 border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl p-8 flex flex-col animate-in slide-in-from-bottom-4 fade-in duration-300 max-h-[90vh] overflow-y-auto">

                {/* ── Step 1: Welcome ─────────────────────────────────────── */}
                {step === 'welcome' && (
                    <>
                        {dots(0)}
                        <div className="text-center mb-8">
                            <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                                <svg width="28" height="28" viewBox="0 0 512 512" fill="none">
                                    <circle cx="256" cy="256" r="200" stroke="#10b981" strokeWidth="36" fill="none" />
                                    <circle cx="256" cy="256" r="110" stroke="#10b981" strokeWidth="28" fill="none" opacity="0.5" />
                                    <circle cx="256" cy="256" r="48" fill="#10b981" />
                                </svg>
                            </div>
                            <h1 className="text-2xl font-black text-white tracking-tight mb-3">Welcome to FindSpot</h1>
                            <p className="text-[13px] text-white/60 leading-relaxed">
                                FindSpot helps you record your finds, manage landowner permissions, and analyse the landscape before you go out.
                            </p>
                        </div>

                        <div className="space-y-2.5 mb-4">
                            <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                <span className="text-lg">📍</span>
                                <p className="text-[12px] text-white/70">Log exactly what you find and where</p>
                            </div>
                            <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                <span className="text-lg">📋</span>
                                <p className="text-[12px] text-white/70">Keep a clear record of your permissions</p>
                            </div>
                            <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                <span className="text-lg">🗺️</span>
                                <p className="text-[12px] text-white/70">Analyse land for signs of past activity</p>
                            </div>
                        </div>

                        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-2xl px-4 py-3">
                            <span className="text-base mt-0.5">🛡️</span>
                            <p className="text-[12px] text-amber-300/80 leading-snug">
                                FindSpot stores everything locally on your device. <span className="font-bold text-amber-300">Back up regularly</span> using the Backup button in Settings — if you lose your device, your records go with it.
                            </p>
                        </div>

                        <button
                            onClick={() => setStep('choose')}
                            className="mt-6 w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Get Started
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Step 2: Choose path ──────────────────────────────────── */}
                {step === 'choose' && (
                    <>
                        {dots(1)}
                        <div className="text-center mb-7">
                            <h2 className="text-xl font-black text-white tracking-tight mb-2">What do you want to do first?</h2>
                            <p className="text-[12px] text-white/40">Pick a starting point — you can do everything else later.</p>
                        </div>

                        <div className="space-y-3">
                            <button
                                onClick={() => setStep('install')}
                                className="w-full text-left bg-white/5 hover:bg-emerald-500/15 border border-white/8 hover:border-emerald-500/40 rounded-2xl px-5 py-4 transition-all duration-150 group"
                            >
                                <div className="flex items-center gap-4">
                                    <span className="text-2xl">📲</span>
                                    <div>
                                        <p className="text-[13px] font-black text-white group-hover:text-emerald-300 transition-colors">Install the app</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Add FindSpot to your home screen</p>
                                    </div>
                                    <svg className="ml-auto opacity-30 group-hover:opacity-70 transition-opacity" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                </div>
                            </button>

                            <button
                                onClick={() => setStep('finds')}
                                className="w-full text-left bg-white/5 hover:bg-emerald-500/15 border border-white/8 hover:border-emerald-500/40 rounded-2xl px-5 py-4 transition-all duration-150 group"
                            >
                                <div className="flex items-center gap-4">
                                    <span className="text-2xl">📍</span>
                                    <div>
                                        <p className="text-[13px] font-black text-white group-hover:text-emerald-300 transition-colors">Record finds</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Log what you find, where you found it</p>
                                    </div>
                                    <svg className="ml-auto opacity-30 group-hover:opacity-70 transition-opacity" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                </div>
                            </button>

                            <button
                                onClick={() => setStep('fieldguide')}
                                className="w-full text-left bg-white/5 hover:bg-emerald-500/15 border border-white/8 hover:border-emerald-500/40 rounded-2xl px-5 py-4 transition-all duration-150 group"
                            >
                                <div className="flex items-center gap-4">
                                    <span className="text-2xl">🗺️</span>
                                    <div>
                                        <p className="text-[13px] font-black text-white group-hover:text-emerald-300 transition-colors">Analyse land</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Scan for signs of past activity</p>
                                    </div>
                                    <svg className="ml-auto opacity-30 group-hover:opacity-70 transition-opacity" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                </div>
                            </button>

                            <button
                                onClick={() => setStep('permissions')}
                                className="w-full text-left bg-white/5 hover:bg-emerald-500/15 border border-white/8 hover:border-emerald-500/40 rounded-2xl px-5 py-4 transition-all duration-150 group"
                            >
                                <div className="flex items-center gap-4">
                                    <span className="text-2xl">📋</span>
                                    <div>
                                        <p className="text-[13px] font-black text-white group-hover:text-emerald-300 transition-colors">Manage permissions</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Keep track of where you can detect</p>
                                    </div>
                                    <svg className="ml-auto opacity-30 group-hover:opacity-70 transition-opacity" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                </div>
                            </button>

                            <button
                                onClick={() => setStep('settings')}
                                className="w-full text-left bg-white/5 hover:bg-emerald-500/15 border border-white/8 hover:border-emerald-500/40 rounded-2xl px-5 py-4 transition-all duration-150 group"
                            >
                                <div className="flex items-center gap-4">
                                    <span className="text-2xl">⚙️</span>
                                    <div>
                                        <p className="text-[13px] font-black text-white group-hover:text-emerald-300 transition-colors">Set up your profile</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Recommended — other features depend on this</p>
                                    </div>
                                    <svg className="ml-auto opacity-30 group-hover:opacity-70 transition-opacity" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                </div>
                            </button>
                        </div>

                        <button onClick={() => setStep('welcome')} className="mt-6 text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                            Back
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Step 3E: Install ─────────────────────────────────────── */}
                {step === 'install' && (
                    <>
                        {dots(2)}
                        <div className="mb-6">
                            <h2 className="text-xl font-black text-white tracking-tight mb-3">Install FindSpot</h2>
                            <p className="text-[13px] text-white/60 leading-relaxed mb-4">
                                FindSpot is a Progressive Web App — no app store needed. Add it to your home screen for the best experience.
                            </p>

                            <div className="space-y-2.5 mb-4">
                                <div className="bg-white/5 rounded-2xl px-4 py-3">
                                    <p className="text-[12px] font-black text-white mb-1">iPhone / iPad</p>
                                    <p className="text-[11px] text-white/45 leading-snug">Open <span className="text-white/70 font-bold">Safari</span> and visit findspot.uk. Tap the <span className="text-white/70 font-bold">Share button</span> (the box with an arrow pointing up), then tap <span className="text-white/70 font-bold">Add to Home Screen</span>. Must be Safari — Chrome on iOS won't work.</p>
                                </div>
                                <div className="bg-white/5 rounded-2xl px-4 py-3">
                                    <p className="text-[12px] font-black text-white mb-1">Android</p>
                                    <p className="text-[11px] text-white/45 leading-snug">Open <span className="text-white/70 font-bold">Chrome</span> and visit findspot.uk. Tap the <span className="text-white/70 font-bold">three-dot menu</span>, then tap <span className="text-white/70 font-bold">Add to Home Screen</span> or <span className="text-white/70 font-bold">Install App</span>. A prompt may also appear automatically at the bottom of the screen.</p>
                                </div>

                            </div>

                            <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl px-4 py-3">
                                <p className="text-[12px] text-emerald-300/90 leading-relaxed">
                                    Once installed, FindSpot opens in its own window with a home screen icon — just like a native app. Core features work without an internet connection.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => setStep('choose')}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Got it — what's next?
                        </button>

                        <button onClick={() => setStep('choose')} className="mt-5 text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                            Back
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Step 3A: Record finds ────────────────────────────────── */}
                {step === 'finds' && (
                    <>
                        {dots(2)}
                        <div className="mb-5">
                            <h2 className="text-xl font-black text-white tracking-tight mb-3">Recording a find</h2>
                            <p className="text-[13px] text-white/60 leading-relaxed mb-4">
                                The typical workflow in FindSpot is straightforward:
                            </p>
                            <div className="flex items-center gap-0 mb-4">
                                {[
                                    { label: 'Permission', sub: 'Where you detect' },
                                    { label: 'Session', sub: 'Each visit out' },
                                    { label: 'Find', sub: 'What you dig up' },
                                ].map((item, i, arr) => (
                                    <React.Fragment key={item.label}>
                                        <div className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-center">
                                            <p className="text-[11px] font-black text-white">{item.label}</p>
                                            <p className="text-[9px] text-white/40 mt-0.5">{item.sub}</p>
                                        </div>
                                        {i < arr.length - 1 && (
                                            <div className="text-white/20 text-xs px-1">→</div>
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>

                            <div className="space-y-2.5 mb-4">
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">📍</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">GPS location</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Capture your exact location when you dig. The app converts it to an OS grid reference automatically — no typing needed.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">🔍</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Object details</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Log object type, period, material, weight, and dimensions. Coin finds have extra fields for denomination and ruler.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">📸</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Photos</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Attach in-situ and cleaned photos. The app can generate a PAS recording sheet from your photos and details with one tap.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">⭐</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Favourites &amp; sharing</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Star your best finds to build a highlights gallery. Share any find as an image card directly from the find record.</p>
                                    </div>
                                </div>
                            </div>

                            <p className="text-[11px] text-white/30 leading-relaxed">
                                You don't have to follow the full workflow — finds can be recorded directly without a session. But linking everything up makes your records much more useful over time.
                            </p>
                        </div>

                        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl px-4 py-3.5 mb-2 space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-sm leading-none">+</span>
                                </div>
                                <p className="text-[12px] font-black text-emerald-300">Add Find button</p>
                            </div>
                            <p className="text-[12px] text-white/55 leading-snug">
                                The green <span className="text-emerald-400 font-bold">Add Find</span> button at the bottom of every screen lets you log a find in one tap. It captures your GPS location and saves a <span className="text-white/80 font-bold">pending find</span> that you can fill in properly later — so you never lose a record in the moment.
                            </p>
                        </div>

                        <button
                            onClick={() => go('/permission')}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Create my first permission
                        </button>

                        <button onClick={() => setStep('choose')} className="mt-5 text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                            Back
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Step 3B: Field Guide ─────────────────────────────────── */}
                {step === 'fieldguide' && (
                    <>
                        {dots(2)}
                        <div className="mb-6">
                            <h2 className="text-xl font-black text-white tracking-tight mb-3">Field Guide</h2>
                            <p className="text-[13px] text-white/60 leading-relaxed mb-2">
                                Field Guide scans the landscape using terrain, satellite, and historic data to highlight where past activity may have occurred.
                            </p>

                            <p className="text-[13px] text-emerald-400 font-bold mb-4">
                                No setup needed — start scanning straight away.
                            </p>

                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 mb-4">
                                <p className="text-[12px] text-amber-300/90 leading-relaxed">
                                    It's a starting point for deciding where to focus — not a guarantee of finds.
                                </p>
                            </div>

                            <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.15em] mb-2.5">What the scan produces</p>
                            <div className="space-y-2 mb-4">
                                <div className="flex items-start gap-3 bg-white/5 rounded-xl px-3.5 py-3">
                                    <span className="text-base shrink-0">🎯</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Targets</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Individual terrain features and signals detected on the ground — things like ridges, depressions, and crop marks.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-xl px-3.5 py-3">
                                    <span className="text-base shrink-0">🔴</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Hotspots</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Clusters of signals that align in one place. These are scored and ranked — tap one to see what the data shows and how to approach it.</p>
                                    </div>
                                </div>
                            </div>

                            <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.15em] mb-2.5">Map options</p>
                            <div className="space-y-2 mb-4">
                                <div className="flex items-start gap-3 bg-white/5 rounded-xl px-3.5 py-3">
                                    <span className="text-base shrink-0">🛰️</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Satellite / Map toggle</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Switch between satellite imagery and standard map view to orientate yourself on the ground.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-xl px-3.5 py-3">
                                    <span className="text-base shrink-0">📡</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">LiDAR &amp; historic maps</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Toggle LiDAR to see a detailed elevation relief — often reveals features invisible on satellite. Historic map overlays (OS 1880, OS 1930) show how the landscape looked in the past.</p>
                                    </div>
                                </div>
                            </div>

                            <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.15em] mb-2.5">Confidence levels</p>
                            <div className="space-y-1.5">
                                {[
                                    { label: 'High Probability', colour: 'text-amber-400',   desc: 'Multiple strong signals agree — worth prioritising' },
                                    { label: 'Strong Signal',    colour: 'text-emerald-400', desc: 'Good agreement across data sources' },
                                    { label: 'Emerging Signal',  colour: 'text-white/60',    desc: 'Some signals present — interesting but not confirmed' },
                                    { label: 'Low Confidence',   colour: 'text-white/35',    desc: 'Weak signals only — treat as exploratory' },
                                ].map(({ label, colour, desc }) => (
                                    <div key={label} className="flex items-start gap-3">
                                        <span className={`text-[11px] font-black ${colour} w-28 shrink-0 leading-snug`}>{label}</span>
                                        <span className="text-[11px] text-white/45 leading-snug">{desc}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => go('/fieldguide')}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Open Field Guide
                        </button>

                        <button onClick={() => setStep('choose')} className="mt-5 text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                            Back
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Step 3D: Settings ───────────────────────────────────── */}
                {step === 'settings' && (
                    <>
                        {dots(2)}
                        <div className="mb-6">
                            <h2 className="text-xl font-black text-white tracking-tight mb-3">Set up your profile</h2>
                            <p className="text-[13px] text-white/60 leading-relaxed mb-4">
                                A few details in Settings make the rest of the app work properly. It only takes a minute and you can update everything later.
                            </p>

                            <div className="space-y-2.5 mb-4">
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">👤</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Your name</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Used as the default collector on every find and permission, and printed on your field reports.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">🔍</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Your detector</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Set your default detector model and it will be pre-filled on every find — no need to type it each time.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">🪪</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">NCMD details</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Your membership number and insurance expiry — included on permission records as proof of cover for landowners.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3">
                                <p className="text-[12px] text-amber-300/90 leading-relaxed">
                                    Field reports and PAS records use your name and details automatically. Without them, those documents will be incomplete.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => go('/settings')}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Open Settings
                        </button>

                        <button onClick={() => setStep('choose')} className="mt-5 text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                            Back
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Step 3C: Permissions ─────────────────────────────────── */}
                {step === 'permissions' && (
                    <>
                        {dots(2)}
                        <div className="mb-7">
                            <h2 className="text-xl font-black text-white tracking-tight mb-3">Managing permissions</h2>
                            <p className="text-[13px] text-white/60 leading-relaxed mb-4">
                                In the UK, you need the landowner's permission before you detect anywhere. FindSpot helps you store that proof properly.
                            </p>
                            <div className="space-y-2.5">
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">👤</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Landowner details</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Store the landowner's name, phone, and address so you always have their contact details to hand in the field.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">✍️</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Signed agreement</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Generate an agreement right there in the field and have the landowner sign it on your screen. No paper needed — it's stored against the permission record instantly.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">🗺️</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Draw your boundary</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Mark the exact area you have permission to detect on a satellite map. Add sub-fields if the land is split into separate areas.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3">
                                    <span className="text-base mt-0.5">📊</span>
                                    <div>
                                        <p className="text-[12px] font-black text-white mb-0.5">Coverage &amp; sessions</p>
                                        <p className="text-[11px] text-white/45 leading-snug">Each visit is logged as a session. Over time you can see what ground you've covered and what's still undetected.</p>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl px-4 py-3 mt-4">
                                <p className="text-[12px] text-emerald-300/90 leading-relaxed">
                                    Start simple — just a name is enough. Add fields, boundaries, and landowner details whenever you're ready.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => go('/permission')}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Create my first permission
                        </button>

                        <button onClick={() => setStep('choose')} className="mt-5 text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                            Back
                        </button>
                        {skipBtn}
                    </>
                )}

                {/* ── Done: settings reminder before navigating ────────────── */}
                {step === 'done' && (
                    <>
                        <div className="text-center mb-7">
                            <div className="w-12 h-12 mx-auto mb-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </div>
                            <h2 className="text-xl font-black text-white tracking-tight mb-2">You're all set</h2>
                            <p className="text-[13px] text-white/50 leading-relaxed">
                                Good luck out there.
                            </p>
                        </div>

                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-4 mb-6">
                            <p className="text-[12px] font-black text-amber-400 mb-1.5">Before you go</p>
                            <p className="text-[12px] text-white/55 leading-snug">
                                You can return to this guide at any time from the <span className="text-amber-400 font-bold">Settings</span> page — look for <span className="text-amber-400 font-bold">Show Quick Start again</span> at the bottom.
                            </p>
                        </div>

                        <button
                            onClick={leave}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl transition-colors duration-150 tracking-wide"
                        >
                            Let's go
                        </button>
                    </>
                )}

            </div>
        </div>
    );
}

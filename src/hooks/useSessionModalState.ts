import { useState } from 'react';
import type { SessionOutcomeResult } from '../engines/session/sessionOutcomeEngine';

export type SessionSummaryData = {
    coverage: number;
    findsCount: number;
    durationMins: number | null;
    totalTime: string | null;
    outcomeResult: SessionOutcomeResult | null;
    openSignalCount: number;
};

const EMPTY_SUMMARY: SessionSummaryData = {
    coverage: 0,
    findsCount: 0,
    durationMins: null,
    totalTime: null,
    outcomeResult: null,
    openSignalCount: 0,
};

/** Owns report, summary, find, notes, signal, and trim modal visibility. */
export function useSessionModalState() {
    const [openFindId, setOpenFindId] = useState<string | null>(null);
    const [showFieldNotes, setShowFieldNotes] = useState(false);
    const [showSignalSheet, setShowSignalSheet] = useState(false);
    const [showTrimUI, setShowTrimUI] = useState(false);
    const [showSummary, setShowSummary] = useState(false);
    const [showExportClubDay, setShowExportClubDay] = useState(false);
    const [showFieldReport, setShowFieldReport] = useState(false);
    const [showLandownerReport, setShowLandownerReport] = useState(false);
    const [landownerReportForField, setLandownerReportForField] = useState(false);
    const [summaryData, setSummaryData] = useState<SessionSummaryData>(EMPTY_SUMMARY);

    return {
        openFindId, setOpenFindId,
        showFieldNotes, setShowFieldNotes,
        showSignalSheet, setShowSignalSheet,
        showTrimUI, setShowTrimUI,
        showSummary, setShowSummary,
        showExportClubDay, setShowExportClubDay,
        showFieldReport, setShowFieldReport,
        showLandownerReport, setShowLandownerReport,
        landownerReportForField, setLandownerReportForField,
        summaryData, setSummaryData,
    };
}

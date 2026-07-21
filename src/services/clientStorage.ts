import { useCallback, useEffect, useState } from 'react';
import { db } from '../db';

export type DurableClientSettingKey =
    | 'findRecordMode'
    | 'fs_club_rally_home_card_dismissed'
    | 'fs_dev_egg'
    | 'fs_going_events'
    | 'fs_club_submissions'
    | 'fs_event_submissions'
    | 'fs_discover_radius'
    | 'fs_discover_tab'
    | 'fs_discover_type'
    | 'fs_fab_used'
    | 'fs_fg_devmode'
    | 'fs_fg_overlay_opacity'
    | 'fs_fg_scan_count'
    | 'fs_fg_sheet'
    | 'fs_first_find'
    | 'fs_first_permission'
    | 'fs_first_session'
    | 'fs_installed'
    | 'fs_nextmove_dismissed'
    | 'fs_onboarding_done'
    | 'fs_onboarding_v2_done'
    | `coach:${string}`;

export type EphemeralLocalKey =
    | 'fs_find_draft'
    | 'fs_clubs_cache'
    | 'fs_events_cache'
    | 'fs_onboarding_force'
    | 'fs_settings_tab'
    | `discover_cache:${string}`;

const BOOLEAN_SETTINGS = new Set<DurableClientSettingKey>([
    'fs_club_rally_home_card_dismissed',
    'fs_dev_egg',
    'fs_fab_used',
    'fs_fg_devmode',
    'fs_fg_sheet',
    'fs_first_find',
    'fs_first_permission',
    'fs_first_session',
    'fs_installed',
    'fs_onboarding_done',
    'fs_onboarding_v2_done',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Runtime half of DurableClientSettingKey's compile-time contract. */
export function isDurableSettingValue(key: DurableClientSettingKey, value: unknown): boolean {
    if (key.startsWith('coach:') || BOOLEAN_SETTINGS.has(key)) return typeof value === 'boolean';
    switch (key) {
        case 'findRecordMode':
            return value === 'quick' || value === 'full';
        case 'fs_discover_radius':
            return value === 10 || value === 25 || value === 50 || value === 100;
        case 'fs_discover_tab':
            return value === 'events' || value === 'clubs';
        case 'fs_discover_type':
            return value === 'all' || value === 'rally' || value === 'club_dig';
        case 'fs_going_events':
            return Array.isArray(value) && value.every(item => typeof item === 'string');
        case 'fs_club_submissions':
        case 'fs_event_submissions':
            return Array.isArray(value) && value.every(isPlainRecord);
        case 'fs_fg_overlay_opacity':
            return isPlainRecord(value)
                && ['lidar', 'lidar-wales', 'os1880', 'os1930'].every(layer => {
                    const opacity = value[layer];
                    return typeof opacity === 'number'
                        && Number.isFinite(opacity)
                        && opacity >= 0
                        && opacity <= 1;
                });
        case 'fs_fg_scan_count':
            return typeof value === 'number' && Number.isInteger(value) && value >= 0;
        case 'fs_nextmove_dismissed':
            return isPlainRecord(value)
                && Object.values(value).every(timestamp =>
                    typeof timestamp === 'number' && Number.isFinite(timestamp)
                );
    }
    return false;
}

function normaliseDurableSetting(
    key: DurableClientSettingKey,
    value: unknown,
): { valid: true; value: unknown } | { valid: false } {
    // One deployed revision stored this setting as string[]. Convert it at the
    // read boundary so no consumer can observe the legacy array shape.
    if (key === 'fs_nextmove_dismissed' && Array.isArray(value)
        && value.every(item => typeof item === 'string')) {
        const migratedAt = Date.now();
        return { valid: true, value: Object.fromEntries(value.map(item => [item, migratedAt])) };
    }
    return isDurableSettingValue(key, value)
        ? { valid: true, value }
        : { valid: false };
}

function decodeLegacy<T>(raw: string, fallback: T): T {
    try {
        if (typeof fallback === 'boolean') return ((raw === '1' || raw === 'true') as T);
        if (typeof fallback === 'number') {
            const parsed = Number(raw);
            return (Number.isFinite(parsed) ? parsed : fallback) as T;
        }
        if (typeof fallback === 'string') return raw as T;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/** Dexie is canonical. localStorage is read only as a one-time legacy source. */
export async function getDurableSetting<T>(
    key: DurableClientSettingKey,
    fallback: T,
    legacyKey: string = key,
): Promise<T> {
    const persisted = await db.settings.get(key);
    if (persisted) {
        const normalised = normaliseDurableSetting(key, persisted.value);
        if (normalised.valid) {
            if (normalised.value !== persisted.value) {
                await db.settings.put({ key, value: normalised.value });
            }
            return normalised.value as T;
        }
        await db.settings.delete(key);
    }
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return fallback;
    const decoded = decodeLegacy(legacy, fallback);
    const normalised = normaliseDurableSetting(key, decoded);
    const value = normalised.valid ? normalised.value as T : fallback;
    await db.settings.put({ key, value });
    localStorage.removeItem(legacyKey);
    return value;
}

export async function setDurableSetting<T>(key: DurableClientSettingKey, value: T): Promise<void> {
    if (!isDurableSettingValue(key, value)) {
        throw new TypeError(`Invalid durable setting value for ${key}`);
    }
    await db.settings.put({ key, value });
    localStorage.removeItem(key);
}

export async function removeDurableSetting(key: DurableClientSettingKey): Promise<void> {
    await db.settings.delete(key);
    localStorage.removeItem(key);
}

export function useDurableSetting<T>(
    key: DurableClientSettingKey,
    fallback: T,
    legacyKey?: string,
): [T, (next: T | ((current: T) => T)) => void, boolean] {
    const [value, setValue] = useState(fallback);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let active = true;
        getDurableSetting(key, fallback, legacyKey).then(next => {
            if (active) setValue(next);
        }).finally(() => {
            if (active) setReady(true);
        });
        return () => { active = false; };
    }, [key, legacyKey]); // fallback is intentionally the initial default, not an identity dependency

    const update = useCallback((next: T | ((current: T) => T)) => {
        setValue(current => {
            const resolved = typeof next === 'function'
                ? (next as (current: T) => T)(current)
                : next;
            void setDurableSetting(key, resolved);
            return resolved;
        });
    }, [key]);
    return [value, update, ready];
}

export const ephemeralLocal = {
    get(key: EphemeralLocalKey): string | null {
        return localStorage.getItem(key);
    },
    set(key: EphemeralLocalKey, value: string): void {
        localStorage.setItem(key, value);
    },
    remove(key: EphemeralLocalKey): void {
        localStorage.removeItem(key);
    },
};

export const ephemeralSession = {
    get(key: string): string | null {
        return sessionStorage.getItem(key);
    },
    set(key: string, value: string): void {
        sessionStorage.setItem(key, value);
    },
    remove(key: string): void {
        sessionStorage.removeItem(key);
    },
};

/** Theme is the sole deliberate localStorage mirror, for pre-React paint. */
export async function setThemeSetting(theme: 'light' | 'dark'): Promise<void> {
    await db.settings.put({ key: 'theme', value: theme });
    localStorage.setItem('fs_theme', theme);
}

export async function migrateLegacyClientStorage(): Promise<void> {
    const defaults: Partial<Record<DurableClientSettingKey, unknown>> = {
        findRecordMode: 'quick',
        fs_club_rally_home_card_dismissed: false,
        fs_dev_egg: false,
        fs_going_events: [],
        fs_club_submissions: [],
        fs_event_submissions: [],
        fs_discover_radius: 25,
        fs_discover_tab: 'events',
        fs_discover_type: 'all',
        fs_fab_used: false,
        fs_fg_devmode: false,
        fs_fg_overlay_opacity: {},
        fs_fg_scan_count: 0,
        fs_fg_sheet: false,
        fs_first_find: false,
        fs_first_permission: false,
        fs_first_session: false,
        fs_installed: false,
        fs_nextmove_dismissed: [],
        fs_onboarding_done: false,
        fs_onboarding_v2_done: false,
    };
    for (const [key, fallback] of Object.entries(defaults)) {
        await getDurableSetting(key as DurableClientSettingKey, fallback);
    }
    const theme = await db.settings.get('theme');
    if (theme?.value === 'light' || theme?.value === 'dark') {
        localStorage.setItem('fs_theme', theme.value);
    }
}

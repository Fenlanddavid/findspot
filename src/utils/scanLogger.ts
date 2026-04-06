// Structured log entry type for the Field Guide scan engine.
// Replaces plain string logs — enables source filtering and level-based styling.

export type LogSource = 'terrain' | 'historic' | 'hotspot' | 'system';
export type LogLevel  = 'info' | 'warn' | 'error';

export interface LogEntry {
    message:   string;
    level:     LogLevel;
    timestamp: number;
    source:    LogSource;
}

export function makeLog(
    message: string,
    source:  LogSource = 'system',
    level:   LogLevel  = 'info',
): LogEntry {
    return { message, level, timestamp: Date.now(), source };
}

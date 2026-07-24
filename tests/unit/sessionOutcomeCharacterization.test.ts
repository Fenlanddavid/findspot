import { describe, expect, it } from 'vitest';
import { computeSessionOutcomeResult } from '../../src/engines/session/sessionOutcomeEngine';

describe('session outcome characterization before section coverage', () => {
  it('pins quiet untracked, productive partial and clustered tracked outcomes', () => {
    expect([
      computeSessionOutcomeResult(0, 0, 90, [], []),
      computeSessionOutcomeResult(5, 30, 120, [], []),
      computeSessionOutcomeResult(
        3,
        65,
        80,
        [
          { lat: 52, lon: 0 },
          { lat: 52.00005, lon: 0.00005 },
          { lat: 52.00008, lon: 0.00003 },
        ],
        [],
      ),
    ]).toMatchInlineSnapshot(`
      [
        {
          "nextMove": {
            "action": "Try a FieldGuide scan",
            "reason": "Scan this area with FieldGuide before your next visit to identify the strongest starting points.",
          },
          "outcome": {
            "colour": "gray",
            "label": "Quiet session",
            "subtitle": "No finds this visit. Conditions, ground type, or area choice may be factors.",
          },
          "spread": null,
        },
        {
          "nextMove": {
            "action": "Complete your coverage",
            "reason": "You have less than 60% field coverage. Finish the ground before drawing conclusions about its potential.",
          },
          "outcome": {
            "colour": "emerald",
            "label": "Productive — incomplete coverage",
            "subtitle": "Finds are coming but significant ground remains unsearched.",
          },
          "spread": null,
        },
        {
          "nextMove": {
            "action": "Continue around the cluster",
            "reason": "Your finds are tightly grouped — there is likely more activity in the immediate surrounding ground.",
          },
          "outcome": {
            "colour": "amber",
            "label": "Developing area",
            "subtitle": "Activity present — worth returning to continue.",
          },
          "spread": "clustered",
        },
      ]
    `);
  });
});

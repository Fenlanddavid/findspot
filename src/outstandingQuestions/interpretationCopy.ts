import type { HypothesisId } from './types';
import type { FieldworkProgress, InterpretationDirection } from './investigationState';

export type InterpretationCopy = { short: string; full: string };
export type InterpretationCopyKey = `${HypothesisId}:${FieldworkProgress}:${InterpretationDirection}`;

const movementUntested = { short: 'Not yet tested — route ground lacks recorded coverage.', full: 'The movement-corridor hypothesis has not yet been tested by enough recorded fieldwork near the route ground.' };
const movementBlocked = { short: 'Access currently limits the route investigation.', full: 'A recorded access problem currently limits what the movement-corridor hypothesis can show.' };
const movementPartSupporting = { short: 'Early fieldwork supports activity along the route.', full: 'Partly completed fieldwork has added finds near the movement corridor, which supports activity following this route.' };
const movementPartContrary = { short: 'Early fieldwork does not yet support route activity.', full: 'Partly completed fieldwork has not added the expected finds near the movement corridor, but coverage is not yet adequate for a firm direction.' };
const movementPartMixed = { short: 'Route evidence is mixed under current conditions.', full: 'Partly completed fieldwork gives mixed evidence for activity along the route, with recorded conditions limiting interpretation.' };
const movementPartNoChange = { short: 'The route interpretation is unchanged so far.', full: 'Partly completed fieldwork has not materially changed the interpretation of activity along the movement corridor.' };
const movementWellSupporting = { short: 'Fieldwork supports activity along the route.', full: 'Well-tested ground has added finds near the movement corridor, supporting activity that followed this route.' };
const movementWellContrary = { short: 'Fieldwork weighs against activity along the route.', full: 'Well-tested ground has not added the expected finds near the movement corridor, which weighs against activity following this route.' };
const movementWellMixed = { short: 'Adequate fieldwork leaves the route evidence mixed.', full: 'The route ground is well tested, but the recorded evidence and field conditions still point in different directions.' };
const movementWellNoChange = { short: 'Adequate fieldwork has not changed the route interpretation.', full: 'The movement corridor is well tested, but the recorded evidence has not shifted the interpretation in either direction.' };

const settlementUntested = { short: 'Not yet tested — the settlement signal lacks coverage.', full: 'The settlement-signal hypothesis has not yet been tested by enough recorded fieldwork around this ground.' };
const settlementBlocked = { short: 'Access currently limits the settlement investigation.', full: 'A recorded access problem currently limits what the settlement-signal hypothesis can show.' };
const settlementPartSupporting = { short: 'Early fieldwork supports the settlement signal.', full: 'Partly completed fieldwork has added multiple nearby finds, supporting the interpretation of activity around the settlement signal.' };
const settlementPartContrary = { short: 'Early fieldwork does not yet support the settlement signal.', full: 'Partly completed fieldwork has not added the expected nearby finds, but coverage is not yet adequate for a firm direction.' };
const settlementPartMixed = { short: 'Settlement evidence is mixed under current conditions.', full: 'Partly completed fieldwork gives mixed evidence for the settlement signal, with recorded conditions limiting interpretation.' };
const settlementPartNoChange = { short: 'The settlement interpretation is unchanged so far.', full: 'Partly completed fieldwork has not materially changed the interpretation of the settlement signal.' };
const settlementWellSupporting = { short: 'Fieldwork supports activity around the settlement signal.', full: 'Well-tested ground has added multiple nearby finds, supporting activity around the settlement signal.' };
const settlementWellContrary = { short: 'Fieldwork weighs against the settlement signal.', full: 'Well-tested ground has not added the expected nearby finds, which weighs against the settlement interpretation.' };
const settlementWellMixed = { short: 'Adequate fieldwork leaves settlement evidence mixed.', full: 'The ground is well tested, but the recorded evidence and field conditions still point in different directions.' };
const settlementWellNoChange = { short: 'Adequate fieldwork has not changed the settlement interpretation.', full: 'The settlement ground is well tested, but the recorded evidence has not shifted the interpretation in either direction.' };

const historicRouteUntested = { short: 'Not yet tested — the route signal lacks coverage.', full: 'The historic-route hypothesis has not yet been tested by enough recorded fieldwork near the route signal.' };
const historicRouteBlocked = { short: 'Access currently limits the route-signal investigation.', full: 'A recorded access problem currently limits what the historic-route hypothesis can show.' };
const historicRoutePartSupporting = { short: 'Early fieldwork supports a historic route.', full: 'Partly completed fieldwork has added nearby finds, supporting the possibility that the route signal is historic.' };
const historicRoutePartContrary = { short: 'Early fieldwork has not strengthened the route signal.', full: 'Partly completed fieldwork has not added nearby finds, but sparse finds alone do not rule out a historic route.' };
const historicRoutePartMixed = { short: 'The historic-route evidence is mixed.', full: 'Partly completed fieldwork leaves mixed evidence for a historic route, and recorded conditions limit interpretation.' };
const historicRoutePartNoChange = { short: 'The historic-route interpretation is unchanged.', full: 'Partly completed fieldwork has not materially changed the interpretation of the route signal.' };
const historicRouteWellSupporting = { short: 'Fieldwork supports a historic route.', full: 'Well-tested ground has added nearby finds, supporting the possibility that the route signal is historic.' };
const historicRouteWellContrary = { short: 'Fieldwork has not strengthened the historic route.', full: 'Well-tested ground has not added nearby finds; this weakens the context but does not rule out a finds-sparse historic route.' };
const historicRouteWellMixed = { short: 'Adequate fieldwork leaves the historic-route evidence mixed.', full: 'The route ground is well tested, but an absence of nearby finds is only mixed evidence against a historic route.' };
const historicRouteWellNoChange = { short: 'Adequate fieldwork has not changed the route interpretation.', full: 'The route ground is well tested, but the recorded evidence has not shifted the historic interpretation in either direction.' };

const romanRoadUntested = { short: 'Not yet tested — the Roman-road corridor lacks coverage.', full: 'The Roman-road activity hypothesis has not yet been tested by enough recorded fieldwork near the corridor.' };
const romanRoadBlocked = { short: 'Access currently limits the Roman-road investigation.', full: 'A recorded access problem currently limits what the Roman-road activity hypothesis can show.' };
const romanRoadPartSupporting = { short: 'Early fieldwork supports activity near the Roman road.', full: 'Partly completed fieldwork has added finds near the Roman-road corridor, supporting associated activity.' };
const romanRoadPartContrary = { short: 'Early fieldwork does not yet support Roman-road activity.', full: 'Partly completed fieldwork has not added the expected finds near the Roman-road corridor, but coverage is not yet adequate for a firm direction.' };
const romanRoadPartMixed = { short: 'Roman-road evidence is mixed under current conditions.', full: 'Partly completed fieldwork gives mixed evidence for activity associated with the Roman road, with recorded conditions limiting interpretation.' };
const romanRoadPartNoChange = { short: 'The Roman-road interpretation is unchanged so far.', full: 'Partly completed fieldwork has not materially changed the interpretation of activity near the Roman-road corridor.' };
const romanRoadWellSupporting = { short: 'Fieldwork supports activity near the Roman road.', full: 'Well-tested ground has added finds near the Roman-road corridor, supporting associated activity.' };
const romanRoadWellContrary = { short: 'Fieldwork weighs against Roman-road activity here.', full: 'Well-tested ground has not added the expected finds near the Roman-road corridor, which weighs against associated activity here.' };
const romanRoadWellMixed = { short: 'Adequate fieldwork leaves Roman-road evidence mixed.', full: 'The Roman-road corridor is well tested, but the recorded evidence and field conditions still point in different directions.' };
const romanRoadWellNoChange = { short: 'Adequate fieldwork has not changed the Roman-road interpretation.', full: 'The Roman-road corridor is well tested, but the recorded evidence has not shifted the interpretation in either direction.' };

export const INTERPRETATION_COPY: Record<InterpretationCopyKey, InterpretationCopy> = {
  'activity_follows_route:BLOCKED:STILL_UNTESTED': movementBlocked,
  'activity_follows_route:BLOCKED:SUPPORTING': movementBlocked,
  'activity_follows_route:BLOCKED:CONTRARY': movementBlocked,
  'activity_follows_route:BLOCKED:MIXED': movementBlocked,
  'activity_follows_route:BLOCKED:NO_CHANGE': movementBlocked,
  'activity_follows_route:UNTESTED:STILL_UNTESTED': movementUntested,
  'activity_follows_route:UNTESTED:SUPPORTING': movementUntested,
  'activity_follows_route:UNTESTED:CONTRARY': movementUntested,
  'activity_follows_route:UNTESTED:MIXED': movementUntested,
  'activity_follows_route:UNTESTED:NO_CHANGE': movementUntested,
  'activity_follows_route:PARTLY_TESTED:STILL_UNTESTED': movementPartNoChange,
  'activity_follows_route:PARTLY_TESTED:SUPPORTING': movementPartSupporting,
  'activity_follows_route:PARTLY_TESTED:CONTRARY': movementPartContrary,
  'activity_follows_route:PARTLY_TESTED:MIXED': movementPartMixed,
  'activity_follows_route:PARTLY_TESTED:NO_CHANGE': movementPartNoChange,
  'activity_follows_route:WELL_TESTED:STILL_UNTESTED': movementWellNoChange,
  'activity_follows_route:WELL_TESTED:SUPPORTING': movementWellSupporting,
  'activity_follows_route:WELL_TESTED:CONTRARY': movementWellContrary,
  'activity_follows_route:WELL_TESTED:MIXED': movementWellMixed,
  'activity_follows_route:WELL_TESTED:NO_CHANGE': movementWellNoChange,

  'settlement_signal_reflects_activity:BLOCKED:STILL_UNTESTED': settlementBlocked,
  'settlement_signal_reflects_activity:BLOCKED:SUPPORTING': settlementBlocked,
  'settlement_signal_reflects_activity:BLOCKED:CONTRARY': settlementBlocked,
  'settlement_signal_reflects_activity:BLOCKED:MIXED': settlementBlocked,
  'settlement_signal_reflects_activity:BLOCKED:NO_CHANGE': settlementBlocked,
  'settlement_signal_reflects_activity:UNTESTED:STILL_UNTESTED': settlementUntested,
  'settlement_signal_reflects_activity:UNTESTED:SUPPORTING': settlementUntested,
  'settlement_signal_reflects_activity:UNTESTED:CONTRARY': settlementUntested,
  'settlement_signal_reflects_activity:UNTESTED:MIXED': settlementUntested,
  'settlement_signal_reflects_activity:UNTESTED:NO_CHANGE': settlementUntested,
  'settlement_signal_reflects_activity:PARTLY_TESTED:STILL_UNTESTED': settlementPartNoChange,
  'settlement_signal_reflects_activity:PARTLY_TESTED:SUPPORTING': settlementPartSupporting,
  'settlement_signal_reflects_activity:PARTLY_TESTED:CONTRARY': settlementPartContrary,
  'settlement_signal_reflects_activity:PARTLY_TESTED:MIXED': settlementPartMixed,
  'settlement_signal_reflects_activity:PARTLY_TESTED:NO_CHANGE': settlementPartNoChange,
  'settlement_signal_reflects_activity:WELL_TESTED:STILL_UNTESTED': settlementWellNoChange,
  'settlement_signal_reflects_activity:WELL_TESTED:SUPPORTING': settlementWellSupporting,
  'settlement_signal_reflects_activity:WELL_TESTED:CONTRARY': settlementWellContrary,
  'settlement_signal_reflects_activity:WELL_TESTED:MIXED': settlementWellMixed,
  'settlement_signal_reflects_activity:WELL_TESTED:NO_CHANGE': settlementWellNoChange,

  'route_signal_is_historic:BLOCKED:STILL_UNTESTED': historicRouteBlocked,
  'route_signal_is_historic:BLOCKED:SUPPORTING': historicRouteBlocked,
  'route_signal_is_historic:BLOCKED:CONTRARY': historicRouteBlocked,
  'route_signal_is_historic:BLOCKED:MIXED': historicRouteBlocked,
  'route_signal_is_historic:BLOCKED:NO_CHANGE': historicRouteBlocked,
  'route_signal_is_historic:UNTESTED:STILL_UNTESTED': historicRouteUntested,
  'route_signal_is_historic:UNTESTED:SUPPORTING': historicRouteUntested,
  'route_signal_is_historic:UNTESTED:CONTRARY': historicRouteUntested,
  'route_signal_is_historic:UNTESTED:MIXED': historicRouteUntested,
  'route_signal_is_historic:UNTESTED:NO_CHANGE': historicRouteUntested,
  'route_signal_is_historic:PARTLY_TESTED:STILL_UNTESTED': historicRoutePartNoChange,
  'route_signal_is_historic:PARTLY_TESTED:SUPPORTING': historicRoutePartSupporting,
  'route_signal_is_historic:PARTLY_TESTED:CONTRARY': historicRoutePartContrary,
  'route_signal_is_historic:PARTLY_TESTED:MIXED': historicRoutePartMixed,
  'route_signal_is_historic:PARTLY_TESTED:NO_CHANGE': historicRoutePartNoChange,
  'route_signal_is_historic:WELL_TESTED:STILL_UNTESTED': historicRouteWellNoChange,
  'route_signal_is_historic:WELL_TESTED:SUPPORTING': historicRouteWellSupporting,
  'route_signal_is_historic:WELL_TESTED:CONTRARY': historicRouteWellContrary,
  'route_signal_is_historic:WELL_TESTED:MIXED': historicRouteWellMixed,
  'route_signal_is_historic:WELL_TESTED:NO_CHANGE': historicRouteWellNoChange,

  'activity_associated_with_roman_road:BLOCKED:STILL_UNTESTED': romanRoadBlocked,
  'activity_associated_with_roman_road:BLOCKED:SUPPORTING': romanRoadBlocked,
  'activity_associated_with_roman_road:BLOCKED:CONTRARY': romanRoadBlocked,
  'activity_associated_with_roman_road:BLOCKED:MIXED': romanRoadBlocked,
  'activity_associated_with_roman_road:BLOCKED:NO_CHANGE': romanRoadBlocked,
  'activity_associated_with_roman_road:UNTESTED:STILL_UNTESTED': romanRoadUntested,
  'activity_associated_with_roman_road:UNTESTED:SUPPORTING': romanRoadUntested,
  'activity_associated_with_roman_road:UNTESTED:CONTRARY': romanRoadUntested,
  'activity_associated_with_roman_road:UNTESTED:MIXED': romanRoadUntested,
  'activity_associated_with_roman_road:UNTESTED:NO_CHANGE': romanRoadUntested,
  'activity_associated_with_roman_road:PARTLY_TESTED:STILL_UNTESTED': romanRoadPartNoChange,
  'activity_associated_with_roman_road:PARTLY_TESTED:SUPPORTING': romanRoadPartSupporting,
  'activity_associated_with_roman_road:PARTLY_TESTED:CONTRARY': romanRoadPartContrary,
  'activity_associated_with_roman_road:PARTLY_TESTED:MIXED': romanRoadPartMixed,
  'activity_associated_with_roman_road:PARTLY_TESTED:NO_CHANGE': romanRoadPartNoChange,
  'activity_associated_with_roman_road:WELL_TESTED:STILL_UNTESTED': romanRoadWellNoChange,
  'activity_associated_with_roman_road:WELL_TESTED:SUPPORTING': romanRoadWellSupporting,
  'activity_associated_with_roman_road:WELL_TESTED:CONTRARY': romanRoadWellContrary,
  'activity_associated_with_roman_road:WELL_TESTED:MIXED': romanRoadWellMixed,
  'activity_associated_with_roman_road:WELL_TESTED:NO_CHANGE': romanRoadWellNoChange,
};

export function interpretationCopyFor(
  hypothesisId: HypothesisId,
  progress: FieldworkProgress,
  direction: InterpretationDirection,
): InterpretationCopy {
  return INTERPRETATION_COPY[`${hypothesisId}:${progress}:${direction}`];
}

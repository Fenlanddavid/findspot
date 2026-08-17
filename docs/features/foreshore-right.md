# FORESHORE-RIGHT decision record

Date: 2026-08-02

Status: **abandoned at the blocking Stage 0 gate**

The proposed feature was correctly framed as a foreshore permissive-right
layer, not as a Crown Estate ownership layer. No product or implementation
work has proceeded because the currently published source fails two
independent prerequisites:

1. The ArcGIS item is governed by The Crown Estate Public Data Licence (GIS)
   v1.1. It grants access and viewing only and prohibits copying, using,
   manipulating, or reproducing the data in whole or substantial part. It does
   not permit the proposed derived R2 asset, offline caching, redistribution,
   or app-store product use.
2. The public FeatureServer contains no semantic attribute that distinguishes
   foreshore from seabed, estuary bed, riverbed, or other coastal title. An
   ownership geometry cannot therefore be filtered into a safe permissive-
   right artefact.

No size/sharding decision was made because there is no lawful, classifiable
foreshore-only source to measure. Scotland remains deliberately out of scope.

The internal evidence record in `docs/ip/2026-08-02-foreshore-right-stage-0.md`
contains the observed service URL, layer IDs, feature counts, CRS, exact field
schemas, licence clauses, and reopening criteria.

Reconsideration requires both an explicit written licence for all intended
distribution/caching uses and an authoritative foreshore-only dataset or
documented foreshore class field. Until both exist, absence informs nothing and
no ownership polygon may be presented as a detecting right.

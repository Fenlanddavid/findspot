# BGS Test Fixtures

## Status: COORDINATES REQUIRED

These fixtures define known test locations for validating BGS WMS layer queryability.

**Rule:** No fixture is complete until it has:
- Confirmed lat/lon
- Confirmed bbox
- A successful GetFeatureInfo response archived
- The confirmed layer name recorded

Use these locations when testing sparse layers (artificial ground, mass movement) — do not
test those layers at random rural centroids and assume an empty return means the layer is not queryable.

---

## Fixture Template

```
Name:              <fixture name>
Purpose:           <what this validates>
Lat/Lon:           <lat>, <lon>
Small bbox:        <south>,<west>,<north>,<east>  (lat-first for WMS 1.3.0 + EPSG:4326)
Expected response: <what you expect the API to return>
Confirmed service: <BGS 625k | BGS 50k>
Layer name:        <confirmed queryable layer name>
Response archived: <yes | no>
Notes:             <anything unusual about this fixture>
```

---

## Fixtures

### 1. Artificial Ground — Central London

```
Name:              artificial_ground_london
Purpose:           Validate Artificial Ground layer queryability
Area:              Central London (confirmed urban/brownfield)
Lat/Lon:           REQUIRED — developer must confirm during discovery
                   Suggested area: City of London, EC2 area
Small bbox:        REQUIRED
Expected response: ROCKNAME containing "MADE GROUND" or "ARTIFICIAL GROUND"
                   or LEXNAME containing "ARTIFICIAL"
Confirmed service: BGS 625k (Phase 1) / BGS 50k (Phase 2)
Layer name:        REQUIRED — confirm from GetCapabilities
Response archived: No
Notes:             Dense urban area. Strong artificial ground signal expected.
                   Do not test at a rural centroid for this layer.
```

### 2. Mass Movement — Lyme Regis Coast

```
Name:              mass_movement_lyme_regis
Purpose:           Validate Mass Movement layer queryability
Area:              Lyme Regis coast, Dorset (confirmed coastal instability / landslip)
Lat/Lon:           REQUIRED — developer must confirm during discovery
                   Suggested area: coastline west of Lyme Regis town
Small bbox:        REQUIRED
Expected response: ROCKNAME or LEXNAME containing "MASS MOVEMENT", "LANDSLIP",
                   or "SLOPE DEPOSIT"
Confirmed service: BGS 625k (Phase 1) / BGS 50k (Phase 2)
Layer name:        REQUIRED — confirm from GetCapabilities
Response archived: No
Notes:             Lyme Regis is one of the most documented landslip areas in England.
                   Good test site for mass movement layer availability.
```

### 3. Chalk Downland — Wiltshire Downs

```
Name:              chalk_wiltshire
Purpose:           Validate Bedrock classification — chalk_downland class
Area:              Wiltshire Downs (Marlborough Downs or Salisbury Plain)
Lat/Lon:           REQUIRED — developer must confirm during discovery
                   Suggested area: near Avebury (~51.43, -1.85)
Small bbox:        REQUIRED
Expected response: ROCKNAME or LITHOLOGY containing "CHALK"
                   STRATNAME containing "CRETACEOUS"
Confirmed service: BGS 625k
Layer name:        REQUIRED — confirm from GetCapabilities
Response archived: No
Notes:             Chalk should produce high-confidence chalk_downland classification.
```

### 4. River Terrace Gravels — Upper Thames Valley

```
Name:              river_terrace_thames
Purpose:           Validate Superficial Deposits classification — river_gravel_terrace class
Area:              Upper Thames Valley (Oxfordshire / Gloucestershire)
Lat/Lon:           REQUIRED — developer must confirm during discovery
                   Suggested area: near Oxford (~51.75, -1.25)
Small bbox:        REQUIRED
Expected response: Superficial ROCKNAME or LITHOLOGY containing
                   "RIVER TERRACE", "TERRACE GRAVEL", or "SAND AND GRAVEL"
Confirmed service: BGS 625k
Layer name:        REQUIRED — confirm from GetCapabilities
Response archived: No
Notes:             The Thames gravel terraces are well-mapped and widely distributed.
                   This fixture validates the river_gravel_terrace classification path.
```

### 5. Alluvium / Fen — Fenland River Margins

```
Name:              alluvium_fenland
Purpose:           Validate Superficial Deposits classification — peat_fen / alluvial_floodplain class
Area:              Fenland, Cambridgeshire / Lincolnshire margins
Lat/Lon:           REQUIRED — developer must confirm during discovery
                   Suggested area: near Ely (~52.39, 0.26)
Small bbox:        REQUIRED
Expected response: Superficial ROCKNAME or LITHOLOGY containing
                   "PEAT", "ALLUVIUM", "ALLUVIAL", or "FENLAND"
Confirmed service: BGS 625k
Layer name:        REQUIRED — confirm from GetCapabilities
Response archived: No
Notes:             The Fens have extensive peat and alluvial deposits.
                   This fixture validates both peat_fen and alluvial_floodplain classification paths.
```

### 6. Heavy Clay — Oxford Clay Belt

```
Name:              heavy_clay_oxford
Purpose:           Validate Bedrock classification — heavy_clay class
Area:              Oxford Clay Belt (Oxfordshire / Bedfordshire)
Lat/Lon:           REQUIRED — developer must confirm during discovery
                   Suggested area: near Bedford (~52.13, -0.47)
Small bbox:        REQUIRED
Expected response: Bedrock ROCKNAME containing "OXFORD CLAY" or "CLAY"
                   LITHOLOGY containing "CLAY" or "MUDSTONE"
Confirmed service: BGS 625k
Layer name:        REQUIRED — confirm from GetCapabilities
Response archived: No
Notes:             Oxford Clay is extensively mapped and well-known.
                   Good test for the heavy_clay classification path.
```

---

## GetFeatureInfo request format (WMS 1.3.0 + EPSG:4326)

Note: BBOX axis order for EPSG:4326 in WMS 1.3.0 is latitude-first (y,x):
`BBOX=minLat,minLon,maxLat,maxLon`

Example for chalk_wiltshire fixture (replace coords once confirmed):
```
https://ogc.bgs.ac.uk/cgi-bin/BGS_Bedrock_and_Superficial_Geology/ows?
  SERVICE=WMS
  &VERSION=1.3.0
  &REQUEST=GetFeatureInfo
  &LAYERS=<CONFIRMED_LAYER>
  &QUERY_LAYERS=<CONFIRMED_LAYER>
  &CRS=EPSG:4326
  &BBOX=<minLat>,<minLon>,<maxLat>,<maxLon>
  &WIDTH=101
  &HEIGHT=101
  &I=50
  &J=50
  &INFO_FORMAT=text/xml
```

Run from browser console (not curl, not Postman) to confirm CORS.

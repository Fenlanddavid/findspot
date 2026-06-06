# BGS WMS Queryable Layers

## Status: DISCOVERY REQUIRED

Layer names in this file are provisional. The implementation uses constants defined in:

`src/engines/geologyContext/geologyContextClient.ts`

Update those constants once discovery is complete.

---

## Pre-Build Gate 0 Checklist

Before any production use of the geology context engine:

- [ ] CORS confirmed from actual PWA/browser origin for GetCapabilities
- [ ] CORS confirmed from actual PWA/browser origin for GetFeatureInfo
- [ ] GetCapabilities downloaded and archived as `bgs-50k-getcapabilities.xml` / `bgs-625k-getcapabilities.xml`
- [ ] Queryable layer names confirmed
- [ ] Test fixtures validated with real GetFeatureInfo responses (see `bgs-test-fixtures.md`)

---

## BGS 625k Service (Phase 1 primary)

**Endpoint:**
```
https://ogc.bgs.ac.uk/cgi-bin/BGS_Bedrock_and_Superficial_Geology/ows?
```

**GetCapabilities test (run from browser console on localhost or deployed build):**
```javascript
fetch('https://ogc.bgs.ac.uk/cgi-bin/BGS_Bedrock_and_Superficial_Geology/ows?SERVICE=WMS&REQUEST=GetCapabilities')
  .then(r => console.log('GETCAPABILITIES PASS', r.status))
  .catch(e => console.error('GETCAPABILITIES FAIL', e));
```

**GetFeatureInfo CORS test (replace with a confirmed layer name and real coordinates):**
```javascript
fetch('https://ogc.bgs.ac.uk/cgi-bin/BGS_Bedrock_and_Superficial_Geology/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=<LAYER>&QUERY_LAYERS=<LAYER>&CRS=EPSG:4326&BBOX=51.47,-1.79,51.48,-1.78&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/xml')
  .then(r => r.text()).then(t => console.log('GETFEATUREINFO PASS', t))
  .catch(e => console.error('GETFEATUREINFO FAIL', e));
```

### Provisional layer names (VERIFY)

| Layer purpose        | Provisional name    | Confirmed? | Confirmed name |
|----------------------|---------------------|------------|----------------|
| Bedrock              | `GBR_BGS_625k_BA`   | No         |                |
| Superficial deposits | `GBR_BGS_625k_SU`   | No         |                |

**Discovery steps:**
1. Fetch GetCapabilities from the 625k endpoint
2. Find `<Layer queryable="1">` elements
3. Record the `<Name>` values for bedrock, superficial, artificial ground, mass movement
4. Validate each with a real GetFeatureInfo at a known test coordinate (see `bgs-test-fixtures.md`)
5. Update constants in `geologyContextClient.ts`

---

## BGS 50k Service (Phase 2)

**Endpoint:**
```
https://map.bgs.ac.uk/arcgis/services/BGS_Detailed_Geology/MapServer/WMSServer?
```

Phase 2 only. Do not use in Phase 1.

**GetCapabilities test:**
```javascript
fetch('https://map.bgs.ac.uk/arcgis/services/BGS_Detailed_Geology/MapServer/WMSServer?SERVICE=WMS&REQUEST=GetCapabilities')
  .then(r => console.log('50K GETCAPABILITIES PASS', r.status))
  .catch(e => console.error('50K GETCAPABILITIES FAIL', e));
```

### Target layers for Phase 2 discovery

| Layer purpose          | Provisional name | Confirmed? | Confirmed name |
|------------------------|------------------|------------|----------------|
| Bedrock                | TBC              | No         |                |
| Superficial deposits   | TBC              | No         |                |
| Artificial ground      | TBC              | No         |                |
| Mass movement          | TBC              | No         |                |
| Geological linear feats| TBC              | No         |                |

---

## Response attribute names

BGS WMS GetFeatureInfo responses vary by service version. The parser in
`geologyContextClient.ts` is namespace-agnostic and attempts to extract these attribute names:

| Attribute     | Purpose                  |
|---------------|--------------------------|
| `ROCKNAME`    | Human-readable rock name |
| `LEXNAME`     | Lexicon name             |
| `LITHOLOGY`   | Lithology description    |
| `LITHNAME`    | Lithology name           |
| `AGE`         | Geological age           |
| `STRATNAME`   | Stratigraphic name       |
| `ROCKTYPE`    | Rock type classification |

Archive confirmed attribute names here once GetFeatureInfo responses have been inspected.

---

## Attribution

All uses of BGS data in FindSpot must include:

> Contains British Geological Survey materials © UKRI 2025. BGS data is used under the Open Government Licence.

This attribution is present in:
- Settings → App → External Data Sources section
- (Add to any future data sources / attribution panel)

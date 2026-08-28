# Network and location privacy

FindSpot is local-first. Its private permissions, finds, trails, notes, landowner details, photographs and backups live in browser IndexedDB and are not automatically uploaded to a FindSpot account or central private-data database.

FindSpot does make geographic requests to public-data services to retrieve maps and information about a place. Depending on the feature, a request may contain an exact or rounded coordinate, bounding box, map tile, postcode/outcode, or six-character geohash cell. Those services can receive normal HTTP metadata such as IP address, time and browser headers.

The reviewed machine-readable origin list is [`src/shared/networkOrigins.json`](../src/shared/networkOrigins.json). `npm run check:network-origins` scans URL/configuration sources, including MapLibre sources, Worker endpoints, WMS/WFS templates and helper constants. A new configured origin fails the release check until it is added to the reviewed list. Build-time geocode overrides are also checked at runtime against the approved automatic-origin list.

## Automatic browser destinations

| Destination | Purpose | Request | Exact coordinate? | Bbox? | Grid/tile identifier? | Permission geometry or private ID? | Proxy/cache |
|---|---|---|---:|---:|---:|---:|---|
| `findspot-geocode.trials-uk.workers.dev` | Search and reverse geocoding | GET | Reverse geocode sends coordinates rounded to 4 decimals | No | No | No | FindSpot Worker; edge and Durable Object cache; upstream Nominatim |
| `findspot-bgs-proxy.trials-uk.workers.dev` | BGS bedrock/superficial context | GET WMS GetFeatureInfo | The request is centred on the selected location | Yes, approximately ±0.003° | Raster dimensions/pixel | No | FindSpot Worker edge cache; fixed BGS upstream |
| `findspot-static.trials-uk.workers.dev` | Historic England-derived and FindSpot static datasets | GET | No | No | Six-character geohash/shard or fixed dataset key | No | R2-backed Worker plus browser caches |
| `a.tile.openstreetmap.org` | OpenStreetMap basemap | GET tile | No | No | z/x/y tile | No | Browser/offline pack cache |
| Esri origins: `services.arcgisonline.com`, `server.arcgisonline.com`, `services.arcgis.com`, `wayback.maptiles.arcgis.com` | Satellite, hillshade, LiDAR and Wayback layers | GET metadata/tile | No | Some metadata requests may imply viewport | z/x/y tile or release ID | No | Browser/offline pack cache where configured |
| `environment.data.gov.uk` | Environment Agency LiDAR | GET WMS/tile | No | WMS tile bbox | Tile/bbox | No | Browser/offline pack cache where configured |
| `mapseries-tilesets.s3.amazonaws.com` | Historic Ordnance Survey mapping | GET tile | No | No | z/x/y tile | No | Browser/offline pack cache |
| Overpass: `overpass-api.de`, `overpass.kumi.systems`, `overpass.osm.ch` | Nearby historic/context features | POST query | Yes, for radial searches | Some searches encode an area | No | No private FindSpot ID | Public failover services; results cached locally |
| `services-eu1.arcgis.com` | Historic England AIM/NHLE fallback queries | GET FeatureServer | No | Yes | No | No | Direct public API; results cached locally. Normal designation scans prefer the static R2 path |
| `findspot-wales-lidar.trials-uk.workers.dev` | Wales LiDAR COG | GET byte range | No | The viewed COG region is inferable from byte ranges only with dataset knowledge | Byte range | No | Fixed R2 object Worker |
| `api.postcodes.io` | Discover distance lookup | GET | No | No | User-entered outcode | No | Direct public API; result kept locally |
| `api.web3forms.com` | Voluntary Discover event/club submission | POST | Only if the user includes location information in the submitted listing | No | May include postcode | Sends the submitted listing/contact fields, not IndexedDB records | Third-party form processor; only on explicit submit |

## Worker upstreams

The geocode Worker can contact only `nominatim.openstreetmap.org`; the BGS proxy can contact only `ogc.bgs.ac.uk`. User input cannot choose their protocol, hostname, port or arbitrary upstream URL. Worker Origin checks discourage browser hotlinking and are not caller authentication.

## User-initiated destinations

Links to PAS, Heritage Gateway, GOV.UK, Google Maps, OpenStreetMap, What3Words, Google Play and Discover listing websites open only after user action. Coordinate links disclose the coordinate to the selected destination when opened. User/content-supplied website links are limited to bounded `http:` or `https:` URLs and cannot use executable schemes.

## Privacy statement

FindSpot may send a location, bounding box, grid cell or similar geographic request to a public data service in order to retrieve information about that place.

FindSpot does not automatically upload the user's private FindSpot records to a FindSpot account or central private database. Explicit exports, browser shares, Discover submissions and links opened by the user are deliberate disclosures and are described separately above.

## Hosting and security headers

Production remains on GitHub Pages. GitHub Pages does not provide repository-level control over arbitrary response security headers, so response-header CSP, Permissions-Policy and cross-origin isolation headers are not release gates. A meta CSP is not currently enabled: the application has inline boot/theme scripts and a geospatial stack with several reviewed data origins, and an incomplete policy would create unreliable offline/map behaviour. If hosting moves to a configurable edge, response-header controls should be introduced only after compatibility testing.

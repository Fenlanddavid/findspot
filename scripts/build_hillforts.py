#!/usr/bin/env python3
"""Build the pinned ADS Atlas edition. No runtime requests to the Atlas.

python3 scripts/build_hillforts.py --source /path/Hillfort-atlas-main-table.csv
Acquisition (explicit, build time only): --download --acquired-at YYYY-MM-DD
"""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import urllib.request
import gzip

SOURCE_URL = 'https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-6508-1/dissemination/Hillfort-atlas-main-table.csv'
SOURCE_SHA256 = '3445e46e48f579f79a59582920529e12b8b159374bcc2929816d97aa118dae8f'
GENERATION = 'atlas-1.1-2017-ads2024-n1'
ROOT = Path(__file__).resolve().parents[1]


def convert(data):
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError('Source checksum changed: review edition, schema and licence before updating the pin')
    # The archive CSV has single-byte text and undefined CP1252 controls.
    # Preserve Latin characters; expose undecodable bytes as replacement glyphs.
    decoded = data.decode('cp1252', errors='replace')
    rows = list(csv.DictReader(io.StringIO(decoded)))
    records, rejected, seen = [], [], set()
    for row in rows:
        atlas = row['Atlas Number']
        try:
            record_id = row['Country Code'] + atlas.zfill(4)
            if not atlas.isdigit() or record_id in seen:
                raise ValueError('missing or duplicate Atlas identifier')
            seen.add(record_id)
            url = row['Record URL']
            if not re.fullmatch(r'https?://hillforts\.arch\.ox\.ac\.uk/records/[A-Za-z]+\d+\.html', url):
                raise ValueError('unexpected source record URL')
            lon, lat = float(row['Longitude']), float(row['Latitude'])
            if not (-11 <= lon <= 2 and 49 <= lat <= 62):
                raise ValueError('missing/nonfinite/out-of-coverage coordinate')
            x, y = float(row['X (EPSG: 3857)']), float(row['Y (EPSG: 3857)'])
            delta = math.hypot((math.degrees(x / 6378137) - lon) * 111000 * math.cos(math.radians(lat)),
                               (math.degrees(math.atan(math.sinh(y / 6378137))) - lat) * 111000)
            if not math.isfinite(delta) or delta > 2:
                raise ValueError('geographic / EPSG:3857 discrepancy exceeds 2 m')
            if not row['Name'].strip():
                raise ValueError('missing recorded name')
            def fields(prefix):
                return {k[len(prefix):]: v for k, v in row.items() if k.startswith(prefix)}
            records.append({
                'id': record_id, 'atlasNumber': atlas, 'name': row['Name'],
                'alternativeNames': row['Alternative Name(s)'], 'country': row['Country'],
                'position': [lon, lat], 'recordUrl': url, 'generation': GENERATION,
                'interpretationStatus': row['Reliability of Interpretation'],
                'interpretationComments': row['Interpretation Comments'],
                'dataStatus': row['Reliability of Data'], 'dataComments': row['Data Comments'],
                'classification': fields('Hillfort Type: '),
                'dating': fields('Dating Evidence: '),
                'description': row['Summary Description'], 'references': row['References'],
                'sourceGrid': {'system': row['Coordinate System'], 'x': row['X Coordinate'], 'y': row['Y Coordinate'], 'ngr': row['NGR']},
                'identifiers': {k: row[k] for k in ['HER', 'HER Primary Record Number', 'HER Second Identifier', 'NMR Record Number', 'NMR Monument Number', 'Scheduled Monument Number']},
            })
        except (ValueError, OverflowError) as error:
            rejected.append({'atlasNumber': atlas, 'reason': str(error)})
    records.sort(key=lambda r: r['id'])
    return records, rejected, decoded.count('\ufffd')


def build(data, acquired_at, out):
    records, rejected, replacement_count = convert(data)
    metadata = {
        'generation': GENERATION, 'schemaVersion': 1,
        'edition': 'Atlas data 1.1 2017', 'publicationDate': '2024-05-03',
        'sourceModifiedDate': '2024-04-16', 'acquiredAt': acquired_at,
        'sourceUrl': SOURCE_URL, 'doi': 'https://doi.org/10.5284/1118744',
        'sourceSha256': SOURCE_SHA256,
        'catalogueChecksum': '912340b6f0cd379155d7c71597d6c07a',
        'observedMd5': hashlib.md5(data).hexdigest(),
        'catalogueChecksumVerified': False,
        'attribution': 'Ralston, I., Lock, G. (2024). Spreadsheets and a Document on the Atlas of Hillforts of Britain and Ireland. Archaeology Data Service. DOI: 10.5284/1118744.',
        'sourceLicence': 'https://creativecommons.org/licenses/by/4.0/',
        'adaptationLicence': 'https://creativecommons.org/licenses/by-sa/4.0/',
        'transformations': 'FindSpot: selected fields, country-prefixed Atlas IDs, deterministic JSON, supplied geographic points checked against inverse EPSG:3857. CP1252 decoding with replacement glyphs for undefined bytes. No invented boundaries, chronology or legal status. FindSpot adaptation under CC BY-SA 4.0; underlying ADS file under CC BY 4.0. Images and linked third-party material excluded.',
        'textReplacementCount': replacement_count,
        'locationPrecision': 'Source accuracy not recorded; decimal places do not establish survey precision.',
        'coverage': ['England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland', 'Isle of Man'],
        'limitations': 'Selective 2012–2016 snapshot, edition 1.1 2017, archived 2024. Channel Islands excluded. Catalogue checksum differs from repeated downloads. Source creation dates differ between documents. Identifiers do not establish current protection. Text contains source encoding defects.',
        'recordCount': len(records), 'rejectedRecordCount': len(rejected), 'rejectedRecords': rejected,
    }
    payload = (json.dumps({'metadata': metadata, 'records': records}, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    out.mkdir(parents=True, exist_ok=True)
    (out / 'hillforts.json').write_bytes(payload)
    manifest = {**metadata, 'outputSha256': hashlib.sha256(payload).hexdigest(), 'outputBytes': len(payload), 'gzipBytes': len(gzip.compress(payload, mtime=0))}
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (out / 'NOTICE.txt').write_text('\n\n'.join(str(metadata[k]) for k in ['attribution', 'sourceLicence', 'adaptationLicence', 'edition', 'transformations', 'locationPrecision', 'limitations']) + '\n')
    print(json.dumps({k: manifest[k] for k in ['recordCount', 'rejectedRecordCount', 'outputBytes', 'gzipBytes', 'outputSha256', 'textReplacementCount']}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--acquired-at', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'public' / 'data' / 'hillforts' / GENERATION)
    args = parser.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.acquired_at):
        parser.error('acquired-at must be an ISO date')
    if bool(args.source) == args.download:
        parser.error('choose exactly one of --source or --download')
    data = args.source.read_bytes() if args.source else urllib.request.urlopen(SOURCE_URL, timeout=60).read()
    build(data, args.acquired_at, args.output)

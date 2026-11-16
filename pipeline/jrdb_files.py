"""Dated JRDB supplements. Only explicit result records can supply outcome labels."""
from collections import defaultdict
import re

METADATA = ('KAA', 'KAB', 'BAB', 'BAC', 'KTA')
MASTERS = ('UKC', 'CSA', 'CZA', 'KSA', 'KZA', 'MSA', 'MZA')
RESULTS = ('SEC', 'SED')
FILE_KINDS = ('TYB', 'HJC', *RESULTS, *METADATA, *MASTERS)
ARCHIVE_RE = re.compile(r'(?:' + '|'.join(FILE_KINDS) + r')\d{6}[^/]*\.zip', re.I)
PACI_RE = re.compile(r'PACI\d{6}[^/]*\.zip', re.I)
MEMBER_RE = re.compile(r'(' + '|'.join(FILE_KINDS) + r')(\d{6})\.txt', re.I)


def supplemental_records(kind, date, data, name):
    # Imported on demand to share the same JRDB key, time and hashing rules as TYB and HJC.
    from .ingest import digest, field_number, race_date, race_key
    if kind in MASTERS:
        count = sum(bool(line.strip()) for line in data.splitlines())
        return [(kind, {'raceId': kind, 'raceDate': date, 'recordCount': count,
                        'records': [], 'sourcePublishedAt': None}, digest(data), name)] if count else []
    groups = defaultdict(list)
    for index, line in enumerate(data.split(b'\n'), 1):
        line = line.rstrip(b'\r')
        if not line.strip():
            continue
        try:
            if kind in RESULTS:
                # SED before the 2022 post-time extension was 370 payload bytes.
                lengths = (344,) if kind == 'SEC' else (370, 374)
                if len(line) not in lengths:
                    raise ValueError(f'{kind} payload length {len(line)} is unsupported')
                key = race_key(line[:8])
                actual_date = race_date(line[18:26].decode('ascii'))
                # Historical editions can include dated foreign/local preceding runs.
                if actual_date != date or key[:2] not in {f'{i:02}' for i in range(1, 11)}:
                    continue
                number = field_number(line[8:10], True)
                size = field_number(line[130:132], True)
                rank = field_number(line[140:142], True)
                abnormal = line[142:143].decode('ascii')
                if key[2:4] != date[2:4] or number not in range(1, 19) or size not in range(2, 19) or abnormal not in '0123456789 ':
                    raise ValueError('Invalid result key, field size or status')
                groups[key].append({'horseNo': number, 'rank': rank, 'fieldSize': size, 'abnormalCode': abnormal.strip()})
            elif kind in ('KAA', 'KAB'):
                if len(line) != (54 if kind == 'KAA' else 70) or line[6:14].decode('ascii') != date:
                    raise ValueError('Invalid meeting length or date')
                key = race_key(line[:6] + b'01')[:6]
                groups[key].append({'weatherCode': line[21:22].decode('ascii').strip(),
                                    'turfGoingCode': line[22:24].decode('ascii').strip(),
                                    'dirtGoingCode': line[40:42].decode('ascii').strip(),
                                    'stage': line[48:49].decode('ascii').strip()})
            elif kind in ('BAB', 'BAC'):
                if len(line) not in ((166,) if kind == 'BAB' else (182, 183)) or line[8:16].decode('ascii') != date:
                    raise ValueError('Invalid program length or date')
                groups[race_key(line[:8])].append({'postTime': line[16:20].decode('ascii').strip() or None,
                    'distance': field_number(line[20:24], True), 'surfaceCode': line[24:25].decode('ascii').strip(),
                    'declaredCount': field_number(line[94:96], True), 'stage': line[124:125].decode('ascii').strip()})
            else:
                if len(line) != 386:
                    raise ValueError('Invalid registration length')
                groups[race_key(line[:8])].append(line[48:56])
        except (ValueError, UnicodeError) as exc:
            raise ValueError(f'{name}: line {index}: {exc}') from exc
    return [(kind, {'raceId': key, 'raceDate': date, 'recordCount': len(rows),
                    'records': rows if kind != 'KTA' else [],
                    'sourcePublishedAt': None}, digest(data), name)
            for key, rows in groups.items()]

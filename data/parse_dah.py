"""Parse Toronto TCA and control zone definitions from the DAH text into lat/lon polygons.
Source: NAV CANADA Designated Airspace Handbook (dah.txt from pdftotext -layout)."""
import re, json, math, sys

text = open("dah.txt").read().splitlines()
text = [re.sub(r"^ {30,}", "", l) for l in text]
NM = 1852.0
R_EARTH = 6371008.8

def dms(s):
    m = re.match(r"([NSWE])(\d{2,3})°(\d{2})'([\d.]+)\"", s)
    h, d, mi, se = m.groups()
    v = int(d) + int(mi) / 60 + float(se) / 3600
    return -v if h in "SW" else v

coord_re = re.compile(r"([NS]\d{2}°\d{2}'[\d.]+\")\s+([WE]\d{3}°\d{2}'[\d.]+\")")

def dest(lat, lon, bearing_deg, dist_m):
    br = math.radians(bearing_deg); d = dist_m / R_EARTH
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)

def bearing(lat1, lon1, lat2, lon2):
    la1, la2 = math.radians(lat1), math.radians(lat2); dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(la2); x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def arc(centre, radius_nm, p_from, p_to, clockwise):
    b0 = bearing(*centre, *p_from); b1 = bearing(*centre, *p_to)
    if clockwise:
        sweep = (b1 - b0) % 360
    else:
        sweep = -((b0 - b1) % 360)
    if abs(sweep) < 1e-6: sweep = 360 if clockwise else -360
    n = max(6, int(abs(sweep) / 3))
    return [dest(*centre, b0 + sweep * i / n, radius_nm * NM) for i in range(1, n)]

def circle(centre, radius_nm, n=120):
    return [dest(*centre, 360 * i / n, radius_nm * NM) for i in range(n)]

def parse_block(lines):
    """lines: the text lines of one airspace item after its header. Returns a polygon [(lat, lon)]."""
    joined = " ".join(l.strip() for l in lines if l.strip() and not l.startswith("©") and "Effective" not in l and "DESIGNATED AIRSPACE" not in l and "DAH " not in l and "TORONTO FLIGHT" not in l and "Source of Canadian" not in l)
    joined = re.sub(r"\s+", " ", joined)
    # full circle form
    m = re.search(r"circle of (\d+) miles radius centred on the following: ([NS]\d{2}°\d{2}'[\d.]+\") ([WE]\d{3}°\d{2}'[\d.]+\")", joined)
    if m and "beginning at" not in joined:
        c = (dms(m.group(2)), dms(m.group(3)))
        return circle(c, float(m.group(1)))
    # tokenise: points and arc instructions
    tokens = []
    pos = 0
    pattern = re.compile(r"([NS]\d{2}°\d{2}'[\d.]+\") ([WE]\d{3}°\d{2}'[\d.]+\")|thence (clockwise|counter-clockwise) along the arc of a circle of (\d+) miles radius centred on")
    for m in pattern.finditer(joined):
        if m.group(1):
            tokens.append(("pt", dms(m.group(1)), dms(m.group(2))))
        else:
            tokens.append(("arc", m.group(3) == "clockwise", float(m.group(4))))
    pts = []
    i = 0
    pending_arc = None
    while i < len(tokens):
        t = tokens[i]
        if t[0] == "pt":
            if pending_arc is not None:
                cw, r, centre = pending_arc
                # t is the end point of the arc
                pts.extend(arc(centre, r, pts[-1], (t[1], t[2]), cw))
                pending_arc = None
            pts.append((t[1], t[2]))
        else:
            # next point token is the centre
            centre_tok = tokens[i + 1]
            pending_arc = (t[1], t[2], (centre_tok[1], centre_tok[2]))
            i += 1
        i += 1
    if pts and pts[0] == pts[-1]: pts.pop()
    return pts

def find_items(start_marker, end_marker):
    s = next(i for i, l in enumerate(text) if start_marker in l)
    e = next(i for i, l in enumerate(text) if end_marker in l and i > s)
    return s, e

items = []
s, e = find_items("3.4.3-7    Toronto, ON TCA:", "3.4.3-13   Detroit, MI TCA")
block = text[s + 1:e]
heads = [i for i, l in enumerate(block) if re.match(r"3\.4\.3-\d+\s+[a-e]\)", l)]
heads.append(len(block))
for a, b in zip(heads, heads[1:]):
    head = block[a]
    m = re.search(r"Class C airspace above ([\d,]+)´ to ([\d,]+)´", head)
    lo, hi = int(m.group(1).replace(",", "")), int(m.group(2).replace(",", ""))
    body = block[a:b]
    poly = parse_block(body)
    items.append({"name": f"Toronto TCA {head.split(')')[0][-1]}", "class": "C", "floor_ft": lo, "ceiling_ft": hi, "polygon": [[round(la, 6), round(lo_, 6)] for la, lo_ in poly]})

# Control zones
for marker, name, cls in [("3.4.4-8    Toronto/Lester B. Pearson Intl, ON:", "Pearson CZ", "C"), ("3.4.4-6    Toronto/Billy Bishop Toronto City Airport, ON:", "Billy Bishop CZ", "C")]:
    s = next(i for i, l in enumerate(text) if marker in l)
    body = []
    for l in text[s + 1:s + 40]:
        if re.match(r"3\.4\.4-\d+\s+\S", l) and "The airspace" not in l: break
        body.append(l)
    head = " ".join(body)
    m = re.search(r"to ([\d,]+)´", head)
    poly = parse_block(body)
    items.append({"name": name, "class": cls, "floor_ft": 0, "ceiling_ft": int(m.group(1).replace(",", "")), "polygon": [[round(la, 6), round(lo_, 6)] for la, lo_ in poly]})

json.dump(items, open("airspace.json", "w"), indent=0)
for it in items:
    print(it["name"], it["floor_ft"], it["ceiling_ft"], len(it["polygon"]), "points")

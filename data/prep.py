"""Build data.json for the YYZ airspace figure from the harvested public sources.
Inputs (all in this folder): traces/*.json (ADS-B Exchange sample day), runways.csv and navaids.csv (OurAirports),
airspace.json (parsed from the NAV CANADA DAH), fixes.json (OpenNav), ne_lakes.json (Natural Earth 10m)."""
import json, glob, math, csv, statistics, os, sys

LAT0, LON0 = 43.658056, -79.631667        # Toronto VOR, the TCA centre (DAH 3.4.3-7)
YYZ = (43.6772, -79.6306)                  # aerodrome reference
YTZ = (43.6275, -79.3962)
R_BOARD = 50.0                             # NM
R_KEEP = 55.0
ALT_KEEP = 20000
COSL = math.cos(math.radians(LAT0))

def nm(lat, lon):
    return (round((lon - LON0) * 60 * COSL, 3), round((lat - LAT0) * 60, 3))
def dist_nm(lat, lon, lat2, lon2):
    return math.hypot((lon - lon2) * 60 * math.cos(math.radians(lat2)), (lat - lat2) * 60)

# ---- runways
runways = []
for row in csv.DictReader(open("runways.csv")):
    if row["airport_ident"] not in ("CYYZ", "CYTZ"): continue
    if not row["le_latitude_deg"] or not row["he_latitude_deg"]: continue
    runways.append({
        "airport": row["airport_ident"], "id": row["le_ident"] + "/" + row["he_ident"],
        "le": {"id": row["le_ident"], "pos": nm(float(row["le_latitude_deg"]), float(row["le_longitude_deg"])), "hdg": float(row["le_heading_degT"] or 0), "lat": float(row["le_latitude_deg"]), "lon": float(row["le_longitude_deg"])},
        "he": {"id": row["he_ident"], "pos": nm(float(row["he_latitude_deg"]), float(row["he_longitude_deg"])), "hdg": float(row["he_heading_degT"] or 0), "lat": float(row["he_latitude_deg"]), "lon": float(row["he_longitude_deg"])},
        "length_ft": int(row["length_ft"] or 0), "width_ft": int(row["width_ft"] or 0),
    })
ends = []
for r in runways:
    if r["airport"] != "CYYZ": continue
    for a, b in (("le", "he"), ("he", "le")):
        # landing on end a means heading toward b: heading = bearing a->b
        ends.append({"id": r[a]["id"], "lat": r[a]["lat"], "lon": r[a]["lon"], "hdg": r[a]["hdg"], "pos": r[a]["pos"]})

# ---- navaids
navaids = []
for row in csv.DictReader(open("navaids.csv")):
    if row["associated_airport"] in ("CYYZ",) and row["type"] in ("VOR-DME", "VOR", "NDB"):
        navaids.append({"id": row["ident"], "name": row["name"], "type": row["type"], "pos": nm(float(row["latitude_deg"]), float(row["longitude_deg"]))})

# ---- airspace
airspace = []
for it in json.load(open("airspace.json")):
    airspace.append({"name": it["name"], "class": it["class"], "floor_ft": it["floor_ft"], "ceiling_ft": it["ceiling_ft"], "polygon": [nm(la, lo) for la, lo in it["polygon"]]})

# ---- fixes
fixes = {}
if os.path.exists("fixes.json"):
    for name, v in json.load(open("fixes.json")).items():
        if isinstance(v, list): fixes[name] = {"pos": nm(v[0], v[1]), "lat": v[0], "lon": v[1]}

# ---- lakes clipped to the board
def clip_polygon(poly, clip):
    """Sutherland-Hodgman: poly and clip are lists of (x, y); clip must be convex and counter-clockwise."""
    def inside(p, a, b): return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0
    def inter(p, q, a, b):
        x1, y1, x2, y2, x3, y3, x4, y4 = *p, *q, *a, *b
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4) or 1e-12
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    out = poly
    for i in range(len(clip)):
        a, b = clip[i], clip[(i + 1) % len(clip)]
        inp, out = out, []
        if not inp: break
        s = inp[-1]
        for e in inp:
            if inside(e, a, b):
                if not inside(s, a, b): out.append(inter(s, e, a, b))
                out.append(e)
            elif inside(s, a, b): out.append(inter(s, e, a, b))
            s = e
    return out
circle = [(R_BOARD * math.cos(2 * math.pi * i / 96), R_BOARD * math.sin(2 * math.pi * i / 96)) for i in range(96)]
lakes = []
for f in json.load(open("ne_lakes.json"))["features"]:
    name = f["properties"].get("name") or ""
    if name not in ("Lake Ontario", "Lake Simcoe", "Lake Erie", "Lake Huron", "Lake Scugog", "Rice Lake"): continue
    g = f["geometry"]
    rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
    for ring in rings:
        pts = [nm(la, lo) for lo, la in ring]
        if all(math.hypot(*p) > R_BOARD for p in pts) and not any(math.hypot(*p) < R_BOARD for p in pts):
            # the ring may still enclose the board; skip if no vertex is near
            if min(math.hypot(*p) for p in pts) > R_BOARD * 1.6: continue
        c = clip_polygon(pts, circle)
        if len(c) >= 3: lakes.append({"name": name, "ring": [(round(x, 2), round(y, 2)) for x, y in c]})

# ---- traces
def heading_diff(a, b):
    return abs((a - b + 180) % 360 - 180)
def runway_for(lat, lon, trk, arriving):
    """The runway whose heading matches the track and whose extended centreline passes nearest the point."""
    best, bestd = None, 9e9
    e_pt, n_pt = nm(lat, lon)
    for e in ends:
        if heading_diff(trk, e["hdg"]) > 25: continue
        ex, ny = e["pos"]
        h = math.radians(e["hdg"])
        ux, uy = math.sin(h), math.cos(h)                 # unit along the runway heading (east, north)
        dx, dy = e_pt - ex, n_pt - ny
        along = dx * ux + dy * uy                         # positive past the threshold in the landing direction
        lateral = abs(dx * uy - dy * ux)
        if abs(along) > 8: continue
        score = lateral + 0.02 * abs(along)
        if score < bestd: best, bestd = e["id"], score
    return best if bestd < 0.6 else None

flights = []
fix_alts = {k: [] for k in fixes}
files = sorted(glob.glob("traces/trace_full_*.json"))
for path in files:
    try:
        d = json.load(open(path))
    except Exception:
        continue
    base = d.get("timestamp", 0)
    typ = d.get("t") or ""
    reg = d.get("r") or ""
    if typ in ("TWR", "GND") or reg in ("TWR", "GND"): continue      # ADS-B test beacons and ground stations
    hexid = d.get("icao") or os.path.basename(path)[11:17]
    pts = []
    callsign = None
    for p in d.get("trace", []):
        dt, lat, lon, alt, gs, trk = p[0], p[1], p[2], p[3], p[4], p[5]
        if lat is None or lon is None: continue
        if dist_nm(lat, lon, LAT0, LON0) > R_KEEP: continue
        ground = alt == "ground"
        if alt is None and not ground: continue
        if not ground and alt > ALT_KEEP: continue
        a = p[8] if len(p) > 8 and isinstance(p[8], dict) else None
        if a and a.get("flight"): callsign = a["flight"].strip()
        pts.append((base + dt, lat, lon, 0 if ground else int(alt), int(gs or 0), int(trk or 0), ground))
    if len(pts) < 6: continue
    # split on gaps
    segs, cur = [], [pts[0]]
    for q in pts[1:]:
        if q[0] - cur[-1][0] > 600: segs.append(cur); cur = [q]
        else: cur.append(q)
    segs.append(cur)
    for seg in segs:
        if len(seg) < 6 or seg[-1][0] - seg[0][0] < 90: continue
        if callsign and callsign.startswith("YZTX"): continue
        # drop altitude spikes: more than 1,500 ft in 10 s or less is not flight
        cleaned = [seg[0]]
        for q in seg[1:]:
            a = cleaned[-1]
            if not a[6] and not q[6] and q[0] - a[0] <= 10 and abs(q[3] - a[3]) > 1500: continue
            cleaned.append(q)
        seg = cleaned
        e0, n0 = nm(seg[0][1], seg[0][2])
        if max(math.hypot(nm(q[1], q[2])[0] - e0, nm(q[1], q[2])[1] - n0) for q in seg) < 1.5: continue   # never moved
        first, last = seg[0], seg[-1]
        near_first = dist_nm(first[1], first[2], *YYZ) < 3 and (first[6] or first[3] < 2300)
        near_last = dist_nm(last[1], last[2], *YYZ) < 3 and (last[6] or last[3] < 2300)
        tz_first = dist_nm(first[1], first[2], *YTZ) < 2 and (first[6] or first[3] < 1800)
        tz_last = dist_nm(last[1], last[2], *YTZ) < 2 and (last[6] or last[3] < 1800)
        if near_last: cat = "arrival"
        elif near_first: cat = "departure"
        elif tz_last: cat = "ytz-arrival"
        elif tz_first: cat = "ytz-departure"
        else: cat = "overflight"
        air = [q for q in seg if not q[6]]
        if len(air) < 4: continue
        rwy = None
        if cat == "arrival":
            tail = [q for q in air if q[3] < 2300][-6:]
            if tail:
                trk = statistics.median(q[5] for q in tail)
                rwy = runway_for(tail[-1][1], tail[-1][2], trk, True)
        elif cat == "departure":
            head = [q for q in air if q[3] < 2300][:6]
            if head:
                trk = statistics.median(q[5] for q in head)
                rwy = runway_for(head[0][1], head[0][2], trk, False)
        # thin: keep a point every >= 6 s or on a heading change
        kept = [seg[0]]
        for q in seg[1:]:
            if q[0] - kept[-1][0] >= 6 or heading_diff(q[5], kept[-1][5]) > 4: kept.append(q)
        if kept[-1] is not seg[-1]: kept.append(seg[-1])
        out = []
        for t, lat, lon, alt, gs, trk, ground in kept:
            e, n = nm(lat, lon)
            out.append([int(t % 86400 if t >= 86400 else t), round(e, 2), round(n, 2), alt, gs, trk, 1 if ground else 0])
        # fixes crossed
        if cat in ("arrival", "departure", "overflight"):
            for name, fx in fixes.items():
                best = None
                for q in air:
                    dd = dist_nm(q[1], q[2], fx["lat"], fx["lon"])
                    if dd < 2.0 and (best is None or dd < best[0]): best = (dd, q[3])
                if best: fix_alts[name].append((cat, best[1]))
        day0 = (base // 86400) * 86400
        flights.append({"hex": hexid, "cs": callsign or reg or hexid.upper(), "type": typ, "cat": cat, "rwy": rwy,
                        "t0": int(out[0][0]), "t1": int(out[-1][0]), "pts": out})

# normalise times to seconds since 00:00Z of the sample day
if flights:
    day0 = min(f["t0"] for f in flights)
    day0 = (day0 // 86400) * 86400
    for f in flights:
        for p in f["pts"]: p[0] -= day0
        f["t0"] -= day0; f["t1"] -= day0

fix_summary = {}
for name, lst in fix_alts.items():
    if lst:
        alts = [a for c, a in lst]
        cats = {}
        for c, a in lst: cats[c] = cats.get(c, 0) + 1
        fix_summary[name] = {"n": len(lst), "median_alt": int(statistics.median(alts)), "cats": cats}

stats = {"flights": len(flights), "by_cat": {}, "arrivals_by_rwy": {}, "departures_by_rwy": {}, "by_hour": [[0, 0] for _ in range(24)]}
for f in flights:
    stats["by_cat"][f["cat"]] = stats["by_cat"].get(f["cat"], 0) + 1
    if f["cat"] == "arrival":
        stats["arrivals_by_rwy"][f["rwy"] or "?"] = stats["arrivals_by_rwy"].get(f["rwy"] or "?", 0) + 1
        stats["by_hour"][min(23, f["t1"] // 3600)][0] += 1
    if f["cat"] == "departure":
        stats["departures_by_rwy"][f["rwy"] or "?"] = stats["departures_by_rwy"].get(f["rwy"] or "?", 0) + 1
        stats["by_hour"][min(23, f["t0"] // 3600)][1] += 1

# ---- airport layout from OpenStreetMap (Overpass export osm_airport.json, ODbL)
airport = {"runways": [], "taxiways": [], "aprons": [], "buildings": [], "towers": [], "helipads": []}
if os.path.exists("osm_airport.json"):
    osm = json.load(open("osm_airport.json"))
    def geom_nm(g): return [nm(q["lat"], q["lon"]) for q in g]
    for e in osm.get("elements", []):
        t = e.get("tags", {}); kind = t.get("aeroway") or t.get("building")
        if e["type"] == "way":
            g = e.get("geometry", [])
            if len(g) < 2: continue
            pts = geom_nm(g)
            closed = g[0]["lat"] == g[-1]["lat"] and g[0]["lon"] == g[-1]["lon"]
            if kind == "runway" and t.get("width"):
                airport["runways"].append({"ref": t.get("ref", ""), "pts": pts, "width_m": float(t["width"])})
            elif kind == "taxiway" and not closed:
                try: w = float(str(t.get("width", "23")).split()[0])
                except ValueError: w = 23.0
                airport["taxiways"].append({"ref": t.get("ref", ""), "pts": pts, "width_m": w})
            elif kind == "apron" and closed:
                airport["aprons"].append({"ref": t.get("ref", t.get("name", "")), "ring": pts[:-1]})
            elif kind in ("terminal", "hangar") and closed:
                airport["buildings"].append({"kind": kind, "name": t.get("name", ""), "ring": pts[:-1]})
            elif kind == "tower":
                c = pts[0] if not closed else (sum(q[0] for q in pts[:-1]) / (len(pts) - 1), sum(q[1] for q in pts[:-1]) / (len(pts) - 1))
                airport["towers"].append({"pos": c})
            elif kind == "helipad" and closed:
                airport["helipads"].append({"ring": pts[:-1]})
        elif e["type"] == "relation" and kind in ("terminal", "apron"):
            for m in e.get("members", []):
                if m.get("role") == "outer" and m.get("geometry"):
                    g = m["geometry"]; pts = geom_nm(g)
                    (airport["buildings"] if kind == "terminal" else airport["aprons"]).append({"kind": kind, "name": t.get("name", ""), "ring": pts})
    print("airport layout:", {k: len(v) for k, v in airport.items()})

data = {"airport": airport, "origin": {"lat": LAT0, "lon": LON0, "name": "Toronto VOR (TCA centre)"}, "board_radius_nm": R_BOARD, "day": "2026-10-01",
        "runways": runways, "navaids": navaids, "airspace": airspace, "fixes": {k: v["pos"] for k, v in fixes.items()}, "fix_summary": fix_summary,
        "lakes": lakes, "flights": flights, "stats": stats}
json.dump(data, open("data.json", "w"), separators=(",", ":"))
print(json.dumps(stats, indent=1))
print("fixes", json.dumps(fix_summary))
print("size MB", round(os.path.getsize("data.json") / 1e6, 2), "lake rings", len(lakes))

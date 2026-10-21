import json, gzip, io, math, os, sys, time, urllib.request, concurrent.futures as cf
DAY = "2026/10/01"
BASE = f"https://samples.adsbexchange.com/readsb-hist/{DAY}/"
LAT, LON = 43.6772, -79.6306
def near(a):
    if a.get('lat') is None: return False
    dy = (a['lat'] - LAT) * 60.0
    dx = (a['lon'] - LON) * 60.0 * math.cos(math.radians(LAT))
    d = math.hypot(dx, dy)
    alt = a.get('alt_baro')
    if alt == 'ground': return d < 8
    try: alt = float(alt)
    except: return d < 40
    return d < 70 and alt < 24000
def fetch(hhmmss):
    url = BASE + hhmmss + "Z.json.gz"
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) yyz-airspace-research"}), timeout=60).read()
            try: txt = gzip.decompress(raw)
            except OSError: txt = raw
            d = json.loads(txt)
            return hhmmss, [a['hex'] for a in d.get('aircraft', []) if near(a)]
        except Exception as e:
            time.sleep(2)
    return hhmmss, None
times = [f"{h:02d}{m:02d}00" for h in range(24) for m in range(0, 60, 5)]
hexes = {}
with cf.ThreadPoolExecutor(6) as ex:
    for t, found in ex.map(fetch, times):
        if found is None:
            print("miss", t, flush=True); continue
        for h in found: hexes.setdefault(h, []).append(t)
        print(t, len(found), "cum", len(hexes), flush=True)
json.dump(hexes, open("hexes.json", "w"))
print("hexes", len(hexes))
os.makedirs("traces", exist_ok=True)
def trace(h):
    out = f"traces/trace_full_{h}.json"
    if os.path.exists(out): return h, True
    url = f"https://samples.adsbexchange.com/traces/{DAY}/{h[-2:]}/trace_full_{h}.json"
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) yyz-airspace-research"}), timeout=60).read()
            try: raw = gzip.decompress(raw)
            except OSError: pass
            open(out, "wb").write(raw); return h, True
        except Exception as e:
            err = e; time.sleep(1.5)
    return h, False
ok = 0
with cf.ThreadPoolExecutor(8) as ex:
    for h, good in ex.map(trace, list(hexes)):
        ok += good
print("traces", ok, "of", len(hexes))

# airspace

3D views of terminal airspace for air traffic control training, built from public data.

`/yyz/` is Toronto Pearson: the Toronto Terminal Control Area and control zones from the NAV CANADA Designated Airspace Handbook, runways from OurAirports, shorelines from Natural Earth, and one full day of real traffic (1 October 2026) from the ADS-B Exchange public sample data, replayed in Three.js.

## Build

```
node build.mjs            # writes yyz/index.html
node build.mjs --light    # writes yyz/index-light.html
```

The page is static. `yyz/data.json` is produced by `data/prep.py` from the harvested traces (`data/harvest.py`, not committed) and the handbook polygons (`data/parse_dah.py`). Three.js loads from unpkg.

See `DATA-SOURCES.md` for every source, its terms, and what is still missing (STAR and SID procedures and sector boundaries are in the paid Canada Air Pilot and are not drawn).

Controls: MENU opens the chip panel. Tap a chip to toggle, tap twice to isolate it in its group, tap a group name for all or none. Keys: space, arrows, 1 to 5 views, L menu, Esc.

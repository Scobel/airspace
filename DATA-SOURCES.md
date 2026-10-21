# Toronto Pearson (CYYZ) terminal airspace: public data confirmed on 2026-10-21

Checked by download or API call, not by search results alone. Each line says what it is, where it is, its terms, and whether the figure uses it.

## Free and official

**Designated Airspace Handbook (DAH), NAV CANADA.** Free PDF, new issue every 56 days. Issue effective 3 September 2026: https://www.navcanada.ca/en/dah20260903.pdf (next: dah20261029). Part 3.4.3 defines the Toronto TCA as five Class C layers (above 1,700 to 2,000 ft within 12 NM of the Toronto VOR with the Brampton and Buttonville cut-outs; above 2,000 to 2,500 ft within 15 to 20 NM; above 2,500 to 3,500 ft within 20 NM; above 3,500 to 4,500 ft within 26 NM; above 4,500 to 12,500 ft within 26 NM) and 3.4.4 the Pearson control zone (7 NM, to 2,500 ft) and Billy Bishop zone. Every boundary is given as points and arcs. The figure parses these into polygons (`data/parse_dah.py`). Crown copyright; reproduction for information is permitted with the source stated.

**Canadian Airport Charts (CAC), NAV CANADA.** Free PDF, same cycle: https://www.navcanada.ca/en/cac20260903.pdf. Pages CYYZ-AD-1 and AD-2 are the aerodrome and HIRO charts. Not drawn yet. Useful for the taxiway layout if the figure grows a ground view.

**AIP Canada (ICAO).** Free. Part ENR 2 describes the control areas in words; ENR 4.4 lists significant points with coordinates. The current issue link on navcanada.ca is behind a page that the fetch tool could not read. Not used yet; it is the official free source for waypoint coordinates.

**OurAirports.** Open data (public domain): runways.csv and navaids.csv at https://davidmegginson.github.io/ourairports-data/. CYYZ runways 05/23, 06L/24R, 06R/24L, 15L/33R, 15R/33L with threshold coordinates and true headings, and the YYZ and YTP VOR-DMEs. Used for the runways and the VOR.

**ADS-B Exchange sample data.** Free, the first day of every month: 5-second global snapshots at https://samples.adsbexchange.com/readsb-hist/YYYY/MM/01/ and per-aircraft 24-hour traces at https://samples.adsbexchange.com/traces/YYYY/MM/01/xx/trace_full_<hex>.json. Terms: non-commercial use of the samples. The harvest (`data/harvest.py`) scanned 1 October 2026 every 5 minutes, found 1,099 aircraft within 70 NM below 24,000 ft, and downloaded all 1,099 traces (126 MB). `data/prep.py` cut them to 55 NM and 20,000 ft and split them into 1,701 flights: 544 Pearson arrivals, 574 departures, 403 overflights, 180 Billy Bishop movements. Used as the replayed traffic.

**OpenSky Network.** The live REST API answers anonymously for a bounding box around Toronto (tested). Historical data needs a research account. Not used.

**Natural Earth 10 m lakes.** Public domain. Lake Ontario, Simcoe and Erie shorelines, clipped to the 50 NM board. Used.

**NAV CANADA Toronto airspace review documents.** Free PDFs: the Six Ideas engagement and post-implementation reports and the 2019 to 2020 continuous-descent reports at https://www.navcanada.ca/en/air-traffic/airspace-reviews/toronto-pearson.aspx. Track density maps and the downwind monitoring segments for 05/23, 06L/24R and 06R/24L. Background only.

**NAV CANADA Toronto Airspace Transition pilot guide (2012).** Public PDF. Gives the arrival gateway fixes by direction (north YMS, northeast IMEBA, east RAGID, south LINNG, west YWT) with the jet and prop STAR pairs, the vector SIDs (LESTER, AVRO, PEARSON) and RNAV SID transitions (TONNY, SEDOG, VERDO, DEDKI, BOMET, BULGE, RIKEM). It is 14 years old; names have moved on (BOXUM, NUBER, VERKO appear in later training material). Background only.

**GTAA.** WebTrak (https://webtrak.emsbk.com/yyz3) shows live and recent tracks in a viewer, no bulk download. Annual noise statistics 2025: 94% of operations on the east-west runways. Preferential night runway system in AIC 10/21. Background only.

## Paid or restricted

**Canada Air Pilot (CAP).** The STAR, SID and approach plates. Sold by NAV CANADA as eCAP (https://products.navcanada.ca/). The controller's unit holds it. If they can share the CYYZ STAR and SID pages or the coordinates, the procedures can be drawn exactly.

**FAA CIFP.** Free ARINC 424 data, United States only. Canadian procedures are listed as a future element.

**X-Plane and Navigraph navdata.** Contain CYYZ procedures, but the licence allows use only inside the simulator.

**OpenNav waypoint pages.** Public web pages, but the fetch returned the same coordinates for different fixes, so the data was rejected.

**FlightAware, Flightradar24, ADS-B Exchange full history.** Paid.

## What the figure draws from this

The board, range rings and bearing ticks; the five TCA steps and two control zones in true plan and exaggerated height; the five CYYZ runways and the Billy Bishop runway; the YYZ VOR; the 1 October 2026 traffic replayed with data blocks, trails, height stems and shadows; all tracks of the day as an overlay; runways in use inferred from the tracks. Not drawn: STAR and SID geometry, sector boundaries of the Toronto terminal unit (not public), terrain.

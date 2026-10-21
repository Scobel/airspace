[out:json][timeout:120];
(
  way["aeroway"~"^(runway|taxiway|apron|terminal|hangar|tower|helipad|parking_position|holding_position)$"](43.635,-79.69,43.715,-79.57);
  relation["aeroway"~"^(apron|terminal)$"](43.635,-79.69,43.715,-79.57);
  way["aeroway"~"^(runway|taxiway|apron|terminal|hangar|helipad)$"](43.615,-79.42,43.645,-79.38);
  way["building"~"^(terminal|hangar)$"](43.635,-79.69,43.715,-79.57);
);
out body geom;

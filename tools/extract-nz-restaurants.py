"""Create the offline restaurant index from Geofabrik's New Zealand OSM extract."""
import json
import sys
from pathlib import Path

import osmium

RESTAURANT_TYPES = {"restaurant", "cafe", "fast_food", "bar", "pub", "food_court", "ice_cream"}
SOURCE = "https://download.geofabrik.de/australia-oceania/new-zealand.html"


class Restaurants(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows = []

    def add(self, element, kind, lat, lng):
        tags = element.tags
        name = tags.get("name", "").strip()
        if not name or tags.get("amenity") not in RESTAURANT_TYPES:
            return
        street = " ".join(filter(None, (tags.get("addr:housenumber"), tags.get("addr:street"))))
        locality = tags.get("addr:city") or tags.get("addr:suburb") or tags.get("addr:town")
        address = tags.get("addr:full") or ", ".join(filter(None, (street, locality, tags.get("addr:postcode"))))
        self.rows.append({
            "id": f"osm-{kind}{element.id}", "name": name, "address": address,
            "lat": round(lat, 6), "lng": round(lng, 6), "fullAddress": bool(street or tags.get("addr:full")),
        })

    def node(self, element):
        if element.location.valid():
            self.add(element, "n", element.location.lat, element.location.lon)

    def way(self, element):
        if not element.tags.get("name") or element.tags.get("amenity") not in RESTAURANT_TYPES:
            return
        points = [node.location for node in element.nodes if node.location.valid()]
        if len(points) > 1 and points[0] == points[-1]:
            points.pop()
        if points:
            self.add(element, "w", sum(p.lat for p in points) / len(points), sum(p.lon for p in points) / len(points))


def main(source, target):
    results = Restaurants()
    results.apply_file(source, locations=True, idx="sparse_mem_array")
    if len(results.rows) < 1000:
        raise RuntimeError("New Zealand extract appears incomplete")
    index = {"attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0",
             "licenseUrl": "https://www.openstreetmap.org/copyright", "source": SOURCE,
             "places": results.rows}
    Path(target).write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    print(f"Indexed {len(results.rows):,} New Zealand food venues.")


if __name__ == "__main__":
    main(*sys.argv[1:])

"""Adjust one line in timeline.json: settime.py <id> <at> [until] (bars)."""
import json, sys
p = "scripts/video/timeline.json"
t = json.load(open(p, encoding="utf-8"))
for l in t["lines"]:
    if l["id"] == sys.argv[1]:
        l["at"] = float(sys.argv[2])
        if len(sys.argv) > 3:
            l["until"] = float(sys.argv[3])
json.dump(t, open(p, "w", encoding="utf-8"), indent=1)

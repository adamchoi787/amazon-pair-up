"""Write video/pairup-demo.srt from the voice word timings (same chunks as the burned-in captions)."""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VO = json.loads((ROOT / "scripts/video/studio/src/generated/vo.json").read_text(encoding="utf-8"))
WHO = {"sam": "Sam", "mei": "Mei", "tony": "Tony", "pairup": "PairUp"}
MAX = 8


def ts(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def chunks(words):
    n = len(words)
    k = math.ceil(n / MAX)
    out, i0 = [], 0
    for c in range(k):
        end = n if c == k - 1 else round((c + 1) * n / k)
        if c < k - 1:
            for d in (0, -1, 1, -2, 2):
                e = end + d
                if i0 + 2 < e < n - 1 and words[e - 1]["w"][-1] in ".,!?:":
                    end = e
                    break
        out.append(words[i0:end])
        i0 = end
    return out


def main():
    cues = []
    for line in VO:
        parts = chunks(line["words"])
        end_line = line["start"] + line["duration"] + 0.2
        for j, part in enumerate(parts):
            a = part[0]["t"]
            b = parts[j + 1][0]["t"] if j + 1 < len(parts) else end_line
            text = " ".join(w["w"] for w in part)
            if j == 0 and line["who"] in WHO:
                text = f"{WHO[line['who']]}: {text}"
            cues.append((a, b, text))
    srt = "\n".join(f"{i + 1}\n{ts(a)} --> {ts(b)}\n{t}\n" for i, (a, b, t) in enumerate(cues))
    (ROOT / "video/pairup-demo.srt").write_text(srt, encoding="utf-8")
    print(f"{len(cues)} captions")


if __name__ == "__main__":
    main()

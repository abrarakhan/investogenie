import json
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from ml.labeler import Bar, LabelingPolicy, label_candidate


D = Decimal
FIXTURES = Path(__file__).with_name("ml") / "golden_vectors.json"


class GoldenLabelerTests(unittest.TestCase):
    def test_golden_vectors(self):
        vectors = json.loads(FIXTURES.read_text())
        for vector in vectors:
            with self.subTest(vector=vector["name"]):
                bars = [Bar(date.fromisoformat(b["session"]), D(b["open"]), D(b["high"]),
                            D(b["low"]), D(b["close"])) for b in vector["bars"]]
                policy = LabelingPolicy(slippage_bps_per_side=D("10"), charges_bps_round_trip=D("10"))
                result = label_candidate(
                    bars,
                    expected_sessions=[date.fromisoformat(v) for v in vector["expected_sessions"]],
                    confirmation_entry=D(vector["entry"]), initial_stop=D(vector["stop"]),
                    target=D(vector["target"]), projected_trail=D(vector["trail"]),
                    trailing_distance=D(vector["trailing_distance"]), atr=D(vector["atr"]),
                    holding_sessions=vector["holding_sessions"], tick_size=D(vector["tick_size"]),
                    policy=policy,
                ).serializable()
                for key, expected in vector["expected"].items():
                    self.assertEqual(result[key], expected, f"{vector['name']}: {key}")

    def test_repeated_execution_is_byte_identical(self):
        vector = json.loads(FIXTURES.read_text())[0]
        bars = [Bar(date.fromisoformat(b["session"]), D(b["open"]), D(b["high"]),
                    D(b["low"]), D(b["close"])) for b in vector["bars"]]
        kwargs = dict(expected_sessions=[date.fromisoformat(v) for v in vector["expected_sessions"]],
                      confirmation_entry=D(vector["entry"]), initial_stop=D(vector["stop"]),
                      target=D(vector["target"]), projected_trail=D(vector["trail"]),
                      trailing_distance=D(vector["trailing_distance"]), atr=D(vector["atr"]),
                      holding_sessions=vector["holding_sessions"], tick_size=D(vector["tick_size"]))
        first = json.dumps(label_candidate(bars, **kwargs).serializable(), sort_keys=True, separators=(",", ":"))
        second = json.dumps(label_candidate(bars, **kwargs).serializable(), sort_keys=True, separators=(",", ":"))
        self.assertEqual(first.encode(), second.encode())


if __name__ == "__main__":
    unittest.main()

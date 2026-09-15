import unittest

from frame_metrics import parse_frames, summarize


class FrameMetricsTest(unittest.TestCase):
    def test_filters_flagged_unfinished_and_invalid_frames(self):
        sample = """---PROFILEDATA---
Flags,IntendedVsync,Vsync,FrameCompleted,
0,1000000,1000000,10000000,
1,2000000,2000000,20000000,
0,3000000,3000000,9223372036854775807,
0,4000000,4000000,0,
---PROFILEDATA---"""
        self.assertEqual(parse_frames(sample), {(1000000, 1000000): 9})

    def test_merges_overlapping_ring_snapshots_without_double_counting(self):
        template = "---PROFILEDATA---\nFlags,IntendedVsync,Vsync,FrameCompleted,\n{}\n---PROFILEDATA---"
        frames = parse_frames(template.format("0,1000000,1000000,10000000,"))
        frames.update(parse_frames(template.format(
            "0,1000000,1000000,10000000,\n0,2000000,2000000,12000000,")))
        self.assertEqual(summarize(frames)["captured_frames"], 2)

    def test_slow_tail_is_not_hidden_by_median(self):
        frames = {(i, i): 9 if i < 90 else 30 for i in range(100)}
        result = summarize(frames)
        self.assertEqual(result["p50_ms"], 9)
        self.assertEqual(result["p95_ms"], 30)
        self.assertEqual(result["at_most_10ms_percent"], 90)
        self.assertFalse(result["p95_at_most_10ms"])

    def test_no_frames_is_not_success(self):
        self.assertIsNone(summarize({})["target_met"])

    def test_target_is_explicit_for_a_nonempty_sample(self):
        self.assertTrue(summarize({(1, 1): 8, (2, 2): 10})["target_met"])
        self.assertFalse(summarize({(1, 1): 11, (2, 2): 10.5})["target_met"])


if __name__ == "__main__":
    unittest.main()

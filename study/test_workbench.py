from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import workbench


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        paths = patch.multiple(workbench, ROOT=self.root, DATA=self.root / ".study")
        paths.start()
        self.addCleanup(paths.stop)
        (self.root / "solutions").mkdir()
        self.solution = self.root / "solutions" / "1330.py"
        self.case = {"input": "", "expected": ""}

    def run_solution(self, source):
        self.solution.write_text(source, encoding="utf-8")
        return workbench.worker("test", {"problem": "1330", "case": self.case})

    def test_blank_solution_is_rejected(self):
        self.assertIn("풀이를 작성", self.run_solution("  \n")["error"])
        self.assertIsNone(workbench.worker("state", {"problem": "1330"})["result"]["run"])

    def test_explicit_empty_output_remains_supported(self):
        self.assertEqual(self.run_solution("pass\n")["result"]["cases"][0]["status"], "pass")

    def test_local_verdicts(self):
        self.case = {"input": "2 5\n", "expected": "<\n"}
        for source, expected in (("print('<')", "pass"), ("print('>')", "wrong"),
                                 ("raise ValueError()", "error"), ("while True: pass", "timeout")):
            with self.subTest(expected=expected):
                result = self.run_solution(source)["result"]
                self.assertEqual(result["cases"][0]["status"], expected)
                state = workbench.worker("state", {"problem": "1330"})["result"]
                self.assertEqual(state["run"]["cases"], result["cases"])

    def test_repeat_hint_has_one_review_link(self):
        (self.root / "ROADMAP.md").write_text("# 학습\n\n## 연습\n", encoding="utf-8")
        data = {"problem": "1330", "title": "두 수 비교하기", "reason": "hint"}
        plan = workbench.worker("review_plan", data)["result"]
        (self.root / "ROADMAP.local.md").write_text(plan["updated"], encoding="utf-8")
        self.assertIsNone(workbench.worker("review_plan", data)["result"]["updated"])

    def test_recommendation_skips_existing_review_problems(self):
        with closing(workbench.database()) as db, db:
            db.executemany("INSERT INTO chats VALUES (?, NULL, NULL, 'q', 'a', 0, 'condition', 1)",
                           [("1330",), ("9498",)])
            roadmap = (
                "# 학습\n\n## 복습 우선\n- [1330](https://www.acmicpc.net/problem/1330/?from=x)\n"
                "\n## 연습\n- [1330](https://acmicpc.net/problem/1330)\n- [9498](https://acmicpc.net/problem/9498)\n"
            )
            with patch.object(workbench, "codex_response", return_value={"problem": "9498", "reason": "조건"}) as coach:
                result = workbench.recommendation(db, roadmap, None)
            self.assertEqual(result["problem"], "9498")
            self.assertEqual(coach.call_args.args[2]["candidates"], [{"number": "9498", "title": "9498"}])

    def test_ac_creates_and_updates_only_personal_progress(self):
        template = self.root / "PROGRESS.md"
        personal = self.root / "PROGRESS.local.md"
        original = "# 진도\n\n| 번호 | 문제 | 상태 | 메모 |\n| --- | --- | --- | --- |\n"
        template.write_text(original, encoding="utf-8")
        data = {"problem": "1330", "status": "ac"}
        self.assertEqual(workbench.worker("record", data)["result"]["official"], "ac")
        recorded = personal.read_text(encoding="utf-8")
        self.assertIn("| 1330 | 백준 1330번 | AC |", recorded)
        self.assertEqual(workbench.worker("record", data)["result"]["official"], "ac")
        self.assertEqual(personal.read_text(encoding="utf-8"), recorded)
        self.assertEqual(template.read_text(encoding="utf-8"), original)

    def test_legacy_synced_status_is_kept_as_local_ac(self):
        with closing(workbench.database()) as db, db:
            db.execute("INSERT INTO official VALUES ('1330', 'synced')")
        data = {"problem": "1330"}
        self.assertEqual(workbench.worker("state", data)["result"]["official"], "ac")
        self.assertIn("error", workbench.worker("record", {**data, "status": "synced"}))


if __name__ == "__main__":
    unittest.main()

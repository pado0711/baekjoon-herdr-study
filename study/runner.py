from collections import deque
import os
from pathlib import Path
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory


OUTPUT_LIMIT = 65536
CASE_TIMEOUT = 3


def limited_output():
    import resource

    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))


def normalize_output(text):
    return "\n".join(line.rstrip() for line in text.splitlines()).rstrip("\n")


def run_case(source, case):
    with TemporaryDirectory(prefix="baekjoon-case-") as directory:
        root = Path(directory)
        (root / "solution.py").write_bytes(source)
        (root / "input.txt").write_text(case["input"], encoding="utf-8")
        with (root / "input.txt").open("rb") as stdin, (root / "stdout.txt").open("wb") as stdout, (root / "stderr.txt").open("wb") as stderr:
            process = subprocess.Popen(
                [sys.executable, "-I", "solution.py"], cwd=root,
                stdin=stdin, stdout=stdout, stderr=stderr,
                start_new_session=True, preexec_fn=limited_output if os.name == "posix" else None,
            )
            timed_out = False
            try:
                process.wait(timeout=CASE_TIMEOUT)
            except subprocess.TimeoutExpired:
                timed_out = True
            finally:
                if os.name == "posix":
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                elif timed_out:
                    process.kill()
                process.wait()
        with (root / "stdout.txt").open("rb") as stream:
            output = stream.read(OUTPUT_LIMIT).decode("utf-8", errors="replace")
        with (root / "stderr.txt").open("rb") as stream:
            error = stream.read(OUTPUT_LIMIT).decode("utf-8", errors="replace")
        if timed_out:
            status = "timeout"
        elif any((root / name).stat().st_size >= OUTPUT_LIMIT for name in ("stdout.txt", "stderr.txt")):
            status = "output_limit"
        elif process.returncode:
            status = "error"
        elif normalize_output(output) == normalize_output(case["expected"]):
            status = "pass"
        else:
            status = "wrong"
        return {
            **case, "status": status, "actual": output[:6000],
            "output_truncated": len(output) > 6000, "stderr": error[:3000],
            "exit_code": process.returncode,
        }


def maze_trace(text):
    """Trace reference BFS, counting the start as one cell."""
    lines = text.splitlines()
    if not lines:
        return None
    try:
        height, width = map(int, lines[0].split())
    except ValueError:
        return None
    grid = lines[1:]
    if (
        not (2 <= height <= 10 and 2 <= width <= 10) or len(grid) != height
        or any(len(row) != width or set(row) - {"0", "1"} for row in grid)
        or grid[0][0] != "1" or grid[-1][-1] != "1"
    ):
        return None
    start = (0, 0)
    goal = (height - 1, width - 1)
    previous = {start: None}
    distance = {start: 1}
    queue = deque([start])
    steps = []
    while queue:
        current = queue.popleft()
        row, column = current
        added = []
        if current != goal:
            for dy, dx in ((-1, 0), (0, 1), (1, 0), (0, -1)):
                y, x = neighbor = (row + dy, column + dx)
                if 0 <= y < height and 0 <= x < width and grid[y][x] == "1" and neighbor not in previous:
                    previous[neighbor] = current
                    distance[neighbor] = distance[current] + 1
                    queue.append(neighbor)
                    added.append(neighbor)
        steps.append({"cell": current, "distance": distance[current], "added": added, "queue": list(queue)})
        if current == goal:
            break
    if goal not in previous:
        return None
    path = []
    cell = goal
    while cell is not None:
        path.append(cell)
        cell = previous[cell]
    return {"grid": grid, "path": path[::-1], "steps": steps}

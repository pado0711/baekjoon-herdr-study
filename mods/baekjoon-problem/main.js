import { View, div } from "gpui-kit";
import { Editor, EditorState, Textarea, TextareaState, h_flex, v_flex } from "gpui-base";
import { checking, exec, focused, nextCommand, props, readTextFile, run, spaces, terminals, theme, writeTextFile } from "herdr";

const resultLabels = {
  pass: "통과", wrong: "출력 불일치", error: "실행 오류", timeout: "시간 초과", output_limit: "출력 제한 초과",
};
const officialLabels = { unconfirmed: "백준 AC 미확인", ac: "백준 AC · 학습 기록에 저장됨" };

export default class BaekjoonProblem extends View {
  init(_args, cx) {
    this.editor = EditorState.new({ language: "python", value: "" });
    this.snapshot = null;
    this.pending = true;
    this.ready = false;
    this.message = "";
    this.error = false;
    this.dirty = false;
    this.example = null;
    this.referenceTrace = null;
    this.lesson = null;
    this.lessonEditing = false;
    this.lessonBusy = false;
    this.lessonMessage = "";
    this.lessonError = false;
    this.showReference = true;
    this.runResult = null;
    this.runSnapshot = null;
    this.caseIndex = 0;
    this.step = 0;
    this.custom = false;
    this.expectEmpty = false;
    this.showTestOutput = false;
    this.practice = false;
    this.official = "unconfirmed";
    this.chat = [];
    this.chatOpen = false;
    this.wide = false;
    this.width = 700;
    this.narrowPane = "problem";
    this.chatBusy = false;
    this.chatError = "";
    this.cliOpening = false;
    this.cliError = "";
    this.cliMessage = "";
    this.hintReviewPending = false;
    this.input = TextareaState.new({ placeholder: "테스트 입력 · 입력이 없으면 비워도 됩니다.", rows: 2 });
    this.expected = TextareaState.new({ placeholder: "기대 출력", rows: 2 });
    this.expected.on("change", (_event, task) => {
      if (this.expected.value()) this.expectEmpty = false;
      task.notify();
    });
    this.question = TextareaState.new({ placeholder: "예: 기대 출력과 왜 1 차이가 나나요?", rows: 2 });
    this.lessonHint = TextareaState.new({ placeholder: "선택 · 문제 조건이나 이해하고 싶은 개념 한 줄", rows: 2 });
    this.editor.on("change", (_event, task) => {
      const dirty = this.editor.value() !== (this.snapshot ?? "");
      this.dirty = dirty;
      task.notify();
    });

    const options = checking()
      ? { problemId: "2178", project: ".", title: "2178 미로 탐색" }
      : props();
    const { problemId, project, title } = options ?? {};
    if (typeof project !== "string" || !project || typeof problemId !== "string" || !/^[1-9][0-9]*$/.test(problemId)) {
      this.pending = false;
      this.message = "학습 로드맵에서 문제를 다시 선택하세요.";
      this.error = true;
      return;
    }
    this.project = project;
    this.problemId = problemId;
    this.title = typeof title === "string" && title ? title : `백준 ${problemId}번`;
    this.relativePath = `solutions/${problemId}.py`;
    this.path = `${project}/${this.relativePath}`;
    this.original = `https://acmicpc.net/problem/${problemId}`;
    if (checking()) {
      this.ready = true;
      this.pending = false;
      return;
    }

    cx.spawn(async (task) => {
      try {
        this.snapshot = await readTextFile(this.path);
        this.editor.set_value(this.snapshot ?? "");
        this.ready = true;
      } catch {
        this.message = "기존 풀이를 열 수 없습니다. 파일 권한을 확인하고 탭을 다시 여세요.";
        this.error = true;
      } finally {
        this.pending = false;
        task.notify();
      }
    });
    cx.spawn(async (task) => {
      try {
        const data = await this.request("state");
        this.example = data.example;
        this.referenceTrace = data.reference_trace;
        this.lesson = data.lesson;
        this.runResult = data.run;
        this.chat = data.chat;
        this.official = data.official;
        this.runSnapshot = data.run?.source ?? null;
      } catch (error) {
        this.message = error.message;
        this.error = true;
      }
      task.notify();
    });
    cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() === "focus" && this.ready) this.editor.focus();
      }
    });
  }

  async request(action, args = {}) {
    const response = await exec("python3", ["study/workbench.py", action, JSON.stringify({ ...args, problem: this.problemId, title: this.title.slice(0, 200) })],
      { cwd: this.project, timeout: 110000 });
    if (response.code !== 0) throw new Error("학습 작업을 실행할 수 없습니다. 프로젝트 설정을 확인하세요.");
    const reply = JSON.parse(response.stdout);
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  }

  async persist(contents) {
    if (this.snapshot === null) {
      const result = await exec("python3", ["-c", "from pathlib import Path\nPath('solutions').mkdir(exist_ok=True)"], { cwd: this.project });
      if (result.code !== 0) throw new Error(result.stderr);
    }
    await writeTextFile(this.path, contents, this.snapshot);
    this.snapshot = contents;
    this.dirty = this.editor.value() !== contents;
  }

  save(cx) {
    if (!this.ready || this.pending) return;
    const contents = this.editor.value();
    this.pending = true;
    this.error = false;
    this.message = "저장 중…";
    cx.notify();
    cx.spawn(async (task) => {
      try {
        await this.persist(contents);
        this.message = "풀이를 저장했습니다.";
      } catch {
        this.message = "저장할 수 없습니다. 파일이 바뀌었다면 수정한 내용을 복사한 뒤 탭을 다시 여세요.";
        this.error = true;
      } finally {
        this.pending = false;
        task.notify();
      }
    });
  }

  test(cx) {
    if (!this.ready || this.pending) return;
    const contents = this.editor.value();
    const testCase = this.custom || !this.hasDefaultCases()
      ? { input: this.input.value(), expected: this.expected.value() } : null;
    if (!contents.trim() || (testCase && !testCase.expected && !this.expectEmpty)) {
      this.error = true;
      this.message = !contents.trim() ? "풀이를 작성한 뒤 테스트를 실행하세요."
        : "기대 출력을 입력하거나 ‘빈 출력 기대’를 선택하세요.";
      cx.notify();
      return;
    }
    this.pending = true;
    this.error = false;
    this.message = "Python 테스트 실행 중…";
    cx.notify();
    cx.spawn(async (task) => {
      try {
        if (contents !== this.snapshot) await this.persist(contents);
        this.runResult = await this.request("test", { case: testCase });
        this.runSnapshot = this.runResult.source;
        this.caseIndex = 0;
        this.step = 0;
        this.showReference = false;
        this.message = "로컬 테스트를 마쳤습니다.";
      } catch (error) {
        this.message = error.message;
        this.error = true;
      } finally {
        this.pending = false;
        task.notify();
      }
    });
  }

  hasDefaultCases() {
    return Boolean(this.example?.cases.length);
  }

  ask(cx) {
    const question = this.question.value().trim();
    if (!question || this.chatBusy || (!this.practice && this.official === "unconfirmed")) return;
    const request = {
      question, practice: this.practice, run: this.runResult?.id ?? null,
      case: this.runResult ? this.caseIndex : null,
    };
    this.chatBusy = true;
    this.chatError = "";
    cx.notify();
    cx.spawn(async (task) => {
      try {
        this.chat.push(await this.request("ask", request));
        if (this.question.value().trim() === question) this.question.set_value("");
      } catch (error) {
        this.chatError = error.message;
      } finally {
        this.chatBusy = false;
        task.notify();
      }
    });
  }

  prepareQuestion(prompt, cx) {
    if (!this.question.value().trim()) this.question.set_value(prompt);
    this.chatOpen = true;
    this.narrowPane = "chat";
    cx.notify();
  }

  makeLesson(cx) {
    if (this.lessonBusy) return;
    const hint = this.lessonHint.value().trim();
    this.lessonBusy = true;
    this.lessonMessage = "";
    this.lessonError = false;
    cx.notify();
    cx.spawn(async (task) => {
      try {
        const reply = await this.request("visualize", { hint });
        if (reply.lesson) {
          this.lesson = reply.lesson;
          this.lessonEditing = false;
          this.showReference = true;
          this.step = 0;
          if (this.official === "unconfirmed") this.practice = true;
        } else {
          this.lessonMessage = reply.message;
        }
      } catch (error) {
        this.lessonError = true;
        this.lessonMessage = error.message;
      } finally {
        this.lessonBusy = false;
        task.notify();
      }
    });
  }

  async recordHintReview() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const plan = await this.request("review_plan", { reason: "hint" });
      if (!plan.updated) {
        this.cliMessage = "힌트를 CLI에 요청했습니다. 이미 복습 우선 목록에 있습니다.";
        this.hintReviewPending = false;
        return;
      }
      try {
        await writeTextFile(`${this.project}/ROADMAP.local.md`, plan.updated, plan.previous);
        this.cliMessage = "힌트를 CLI에 요청하고 복습 우선에 추가했습니다.";
        this.hintReviewPending = false;
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  }

  retryHintReview(cx) {
    if (!this.hintReviewPending || this.cliOpening) return;
    this.cliOpening = true;
    this.cliError = "";
    cx.notify();
    cx.spawn(async (task) => {
      try {
        await this.recordHintReview();
      } catch {
        this.cliError = "복습 우선 목록에 저장할 수 없습니다. 로드맵 파일을 확인하세요.";
      } finally {
        this.cliOpening = false;
        task.notify();
      }
    });
  }

  openCli(cx, topic = "", stage = null, mode = null) {
    if (this.cliOpening) return;
    const target = focused();
    if (!target?.pane) return;
    this.cliOpening = true;
    this.cliError = "";
    this.cliMessage = "";
    const selection = {
      run: stage ? stage.run : this.runResult?.id ?? null,
      case: stage ? stage.caseIndex : this.runResult ? this.caseIndex : null,
      step: stage?.index ?? null,
      visual_kind: stage?.kind,
      revision: stage?.revision,
      topic,
      study_note: mode ? this.lessonHint.value().trim() : undefined,
    };
    cx.notify();
    cx.spawn(async (task) => {
      try {
        const { name, folder, argv } = await this.request("cli_context", selection);
        if (focused()?.tab !== target.tab) return;
        const existing = terminals().find((terminal) => terminal.state === "live" && terminal.cwd === folder
          && (terminal.agent === "codex" || terminal.program?.key === "codex"
            || /(?:^|[\\/])codex(?:\.exe)?$/i.test(terminal.argv?.[0] ?? "")));
        if (existing) run("pane.focus", { terminal: existing.address });
        else {
          run("pane.focus", { pane: target.pane });
          run("terminal.open", { name, folder, argv, place: "right" });
        }
        if (this.official === "unconfirmed") this.practice = true;
        this.chatOpen = false;
        if (this.narrowPane === "chat") this.narrowPane = "problem";
        if (mode) {
          await this.request("cli_learning", { mode, terminal: existing?.address });
          if (mode === "hint") {
            this.cliMessage = "접근 힌트를 CLI에 요청했습니다.";
            this.hintReviewPending = true;
            try {
              await this.recordHintReview();
            } catch {
              this.cliError = "복습 우선 목록에 저장하지 못했습니다.";
            }
          } else {
            this.cliMessage = "알고리즘 개념을 CLI에 요청했습니다.";
          }
        }
      } catch (error) {
        this.cliError = error.message;
      } finally {
        this.cliOpening = false;
        task.notify();
      }
    });
  }

  openRoadmap(cx) {
    const space = spaces().find((item) => !item.machine && item.folder === this.project);
    const tab = space?.tabs.find((item) => item.name === "백준 학습 로드맵");
    if (!tab) {
      this.chatError = "로드맵 탭을 찾을 수 없습니다. ./setup으로 학습 로드맵을 여세요.";
      cx.notify();
      return;
    }
    run("tab.select", { id: tab.id });
  }

  record(status, cx) {
    if (this.pending) return;
    this.pending = true;
    this.error = false;
    cx.notify();
    cx.spawn(async (task) => {
      try {
        this.official = (await this.request("record", { status })).official;
        this.message = officialLabels[this.official];
      } catch (error) {
        this.message = error.message;
        this.error = true;
      } finally {
        this.pending = false;
        task.notify();
      }
    });
  }

  button(id, label, handler, primary = false) {
    const t = theme();
    return div().id(id).px(9).py(6).rounded(6).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .hover((style) => style.bg(primary ? t.solid : t.hover))
      .child(label).on_click((_event, cx) => handler(cx));
  }

  compactText(label, text, t) {
    return v_flex().flex_1().min_w(0).gap(4).px(8).py(5).bg(t.raised).rounded(5)
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(div().text_size(12).child(text || "∅"));
  }

  visualControls(title, steps, askStage) {
    const change = (direction, cx) => {
      this.step = Math.max(0, Math.min(steps - 1, this.step + direction));
      cx.notify();
    };
    return h_flex().gap(6).items_center().justify_between().flex_wrap()
      .child(div().font_semibold().child(`${title} ${this.step + 1}/${steps}단계`))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button("visual-prev", "이전", (cx) => change(-1, cx)))
        .child(this.button("visual-next", "다음", (cx) => change(1, cx)))
        .child(this.button("visual-question", "이 단계 질문", askStage, true)));
  }

  diagramView(diagram, kind, t) {
    const step = diagram.steps[this.step];
    const isTest = kind === "test";
    const askStage = (cx) => this.openCli(cx, isTest ? "선택한 테스트의 입력과 출력" : diagram.concept, {
      kind, index: this.step, revision: diagram.revision,
      run: isTest ? this.runResult.id : null, caseIndex: isTest ? this.caseIndex : null,
    });
    const content = v_flex().gap(8)
      .child(this.visualControls(diagram.concept, diagram.steps.length, askStage))
      .child(div().text_size(12).text_color(t.muted).child(diagram.overview))
      .child(div().font_semibold().child(step.title))
      .child(div().text_size(12).child(step.action));
    for (const item of step.rows) {
      const cells = h_flex().gap(5).flex_wrap();
      for (const cell of item.cells) {
        const focus = cell.state === "focus";
        const changed = cell.state === "changed";
        cells.child(div().min_w(22).max_w(245).rounded(5).px(8).py(4).border(1)
          .border_color(focus || changed ? t.accent : t.border)
          .bg(focus ? t.accent : changed ? t.selected : t.raised)
          .text_color(focus ? t.accent_foreground : t.foreground)
          .text_size(12).child(cell.text));
      }
      content.child(v_flex().gap(3)
        .child(div().text_size(11).text_color(t.muted).child(item.label)).child(cells));
    }
    content.child(div().p(8).rounded(5).bg(t.raised).text_size(12).child(step.reason));
    if (this.step === diagram.steps.length - 1) {
      content.child(div().text_size(12).text_color(t.accent).child(diagram.prediction));
    }
    return content;
  }

  traceView(trace, t) {
    const step = trace.steps[this.step];
    const cellKey = ([row, column]) => `${row},${column}`;
    const coordinate = ([row, column]) => `(${row}, ${column})`;
    const distances = new Map([["0,0", 1]]);
    for (const item of trace.steps.slice(0, this.step + 1)) {
      for (const cell of item.added) distances.set(cellKey(cell), item.distance + 1);
    }
    const queued = new Set(step.queue.map(cellKey));
    const added = new Set(step.added.map(cellKey));
    const before = this.step ? trace.steps[this.step - 1].queue : [[0, 0]];
    const currentCell = cellKey(step.cell);
    const completed = this.step === trace.steps.length - 1;
    const path = new Set(completed ? trace.path.map(cellKey) : []);
    const gridBudget = this.wide ? 192 : 132;
    const cellSize = Math.max(19, Math.min(54, Math.floor(gridBudget / Math.max(trace.grid.length, trace.grid[0].length))));
    const board = v_flex().gap(3).p(8).bg(t.raised).rounded(6);
    for (const [row, cells] of trace.grid.entries()) {
      const line = h_flex().gap(3);
      for (const [column, cell] of Array.from(cells).entries()) {
        const key = cellKey([row, column]);
        const distance = distances.get(key);
        const current = key === currentCell;
        const pending = !completed && queued.has(key);
        const marked = path.has(key) || (!completed && Boolean(distance));
        line.child(div().w(cellSize).h(cellSize).rounded(4).border(added.has(key) ? 2 : 1).border_color(pending ? t.accent : t.border)
          .flex().items_center().justify_center().text_size(13)
          .bg(current ? t.accent : marked ? t.selected : cell === "0" ? t.border : t.surface)
          .text_color(current ? t.accent_foreground : t.foreground)
          .child(distance ? String(distance) : cell === "0" ? "×" : row === trace.grid.length - 1 && column === cells.length - 1 ? "끝" : ""));
      }
      board.child(line);
    }
    const queueRow = (label, entries, highlight) => {
      const queue = h_flex().gap(4).flex_wrap().items_center();
      if (!entries.length) queue.child(div().text_size(12).text_color(t.muted).child("비어 있음"));
      for (const [index, cell] of entries.entries()) {
        if (index > 0) queue.child(div().text_size(11).text_color(t.muted).child("→"));
        const active = highlight(cell, index);
        queue.child(div().rounded(4).px(5).py(3).text_size(12).border(1).border_color(active ? t.accent : t.border)
          .bg(active ? t.selected : t.raised).child(coordinate(cell)));
      }
      return v_flex().gap(3).child(div().text_size(11).text_color(t.muted).child(label)).child(queue);
    };
    const details = v_flex().gap(8).flex_1().min_w(120)
      .child(queueRow("꺼내기 전 · 큐 앞에서 뒤 순서", before, (_cell, index) => index === 0))
      .child(div().text_size(12).font_semibold().child(`${coordinate(step.cell)} 꺼냄 · 시작에서 ${step.distance}칸`))
      .child(queueRow("처리 후 · 테두리는 새로 추가한 칸", step.queue, (cell) => added.has(cellKey(cell))));
    const explanation = completed
      ? `도착 칸을 거리 ${step.distance}에서 꺼냈습니다. 거리가 작은 칸부터 처리했으므로 강조된 경로가 최단입니다.`
      : step.added.length
        ? `인접한 미방문 칸 ${step.added.length}개에 거리 ${step.distance + 1}을 적고 큐 뒤에 넣습니다. 이때 방문 처리하면 다른 경로에서 같은 칸을 다시 넣지 않습니다.`
        : "이 칸에서 새로 발견할 이웃이 없습니다. 벽, 격자 밖, 이미 방문한 칸은 큐에 넣지 않고 다음 칸으로 넘어갑니다.";
    const legend = h_flex().gap(6).flex_wrap();
    for (const [label, color, edge] of [
      ["꺼낸 칸", t.accent, t.accent], [completed ? "최단 경로" : "큐에서 대기", t.selected, completed ? t.border : t.accent],
      ["벽 ×", t.border, t.border],
    ]) {
      legend.child(h_flex().gap(4).items_center()
        .child(div().w(10).h(10).rounded(3).bg(color).border(1).border_color(edge))
        .child(div().text_size(11).text_color(t.muted).child(label)));
    }
    const askStage = (cx) => this.openCli(cx,
      "현재 BFS 단계에서 큐에 들어오고 나가는 칸과 거리의 변화",
      { run: this.showReference ? null : this.runResult?.id ?? null,
        caseIndex: this.showReference ? null : this.caseIndex, index: this.step, kind: "maze" },
    );
    return v_flex().gap(10)
      .child(this.visualControls("BFS", trace.steps.length, askStage))
      .child(div().text_size(12).child("가까운 칸부터 탐색합니다. 격자의 숫자는 시작 칸을 포함한 거리입니다."))
      .child(h_flex().gap(10).items_start().flex_wrap().child(v_flex().gap(6).child(board).child(legend)).child(details))
      .child(div().p(8).rounded(5).bg(t.raised).text_size(12).child(explanation));
  }

  testsView(t) {
    const rows = v_flex().gap(8);
    const header = h_flex().gap(6).items_center().justify_between().flex_wrap()
      .child(div().font_semibold().child("테스트와 학습"));
    if (this.hasDefaultCases()) {
      header.child(this.button("custom-case", this.custom ? "연습 케이스 사용" : "직접 입력할 케이스", (cx) => {
        this.custom = !this.custom;
        cx.notify();
      }));
    }
    if ((this.custom || !this.hasDefaultCases()) && !this.expected.value()) {
      header.child(this.button("expect-empty", this.expectEmpty ? "빈 출력 기대 ✓" : "빈 출력 기대", (cx) => {
        this.expectEmpty = !this.expectEmpty;
        cx.notify();
      }, this.expectEmpty));
    }
    rows.child(header);
    const caseFields = this.custom || !this.hasDefaultCases()
      ? h_flex().gap(8)
        .child(Textarea.new(this.input).flex_1().min_w(0).h(52).px(6).border(1).border_color(t.input))
        .child(Textarea.new(this.expected).flex_1().min_w(0).h(52).px(6).border(1).border_color(t.input))
      : null;
    if (!this.runResult) {
      if (caseFields) rows.child(caseFields);
      return rows;
    }
    const cases = this.runResult.cases;
    const selected = cases[this.caseIndex];
    const passed = cases.filter((item) => item.status === "pass").length;
    const choices = h_flex().gap(6).flex_wrap();
    for (const [index, item] of cases.entries()) {
      choices.child(this.button(`case-${index}`, `${item.name} · ${resultLabels[item.status]}`, (cx) => {
        this.caseIndex = index;
        this.step = 0;
        this.showReference = false;
        cx.notify();
      }, index === this.caseIndex));
    }
    choices.child(this.button("diagnose-case", "이 테스트 진단", (cx) => this.prepareQuestion(
      "이 테스트와 실행 당시 코드를 보고 헷갈리기 쉬운 개념 한 가지를 짚어 줘. 내가 이해했는지 확인할 작은 질문도 내 줘.", cx,
    )));
    choices.child(this.button("test-output", this.showTestOutput ? "입출력 접기" : "입출력 보기", (cx) => {
      this.showTestOutput = !this.showTestOutput;
      cx.notify();
    }));
    rows.child(div().font_semibold().child(`로컬 테스트 · ${passed}/${cases.length} 통과`))
      .child(choices)
      .child(div().text_size(11).text_color(t.muted)
        .child(`실행 ${this.runResult.id.slice(0, 8)}${this.editor.value() === this.runSnapshot ? "" : " · 이전 코드 기준"}`));
    if (caseFields) rows.child(caseFields);
    if (!this.showTestOutput) return rows;
    const outputs = v_flex().flex_1().min_w(0).gap(6)
      .child(h_flex().items_start().gap(8)
        .child(this.compactText("입력", selected.input, t))
        .child(this.compactText("기대 출력", selected.expected, t))
        .child(this.compactText("실제 출력", selected.actual, t)));
    if (selected.output_truncated) outputs.child(div().text_color(t.muted).child("실제 출력은 일부만 표시합니다."));
    if (selected.stderr) outputs.child(this.compactText("오류 출력", selected.stderr, t));
    return rows.child(outputs);
  }

  codeLine(turn, cx) {
    if (turn.run !== this.runResult?.id || this.runSnapshot !== this.editor.value()) return;
    const lines = this.editor.value().split("\n");
    const start = lines.slice(0, turn.line - 1).reduce((offset, line) => offset + line.length + 1, 0);
    this.narrowPane = "editor";
    cx.notify();
    cx.timer.after(0, () => {
      this.editor.set_selected_range({ start, end: start + lines[turn.line - 1].length });
      this.editor.focus();
    });
  }

  chatView(t) {
    const panel = v_flex().gap(8).flex_1().min_w(0).min_h(0);
    const allowed = this.practice || this.official !== "unconfirmed";
    panel.child(div().font_semibold().child("Codex 풀이 진단"));
    if (!allowed) {
      panel.child(div().text_color(t.muted).child("제출용 풀이는 백준 AC를 기록한 뒤 복습할 수 있습니다."));
      panel.child(this.button("practice-on", "AI 연습 모드 시작", (cx) => { this.practice = true; cx.notify(); }, true));
    } else if (this.practice) {
      panel.child(this.button("practice-off", "AI 연습 모드 종료", (cx) => { this.practice = false; cx.notify(); }));
    }

    const history = v_flex().id("chat-history").gap(8).flex_1().min_h(0).overflow_y_scrollbar();
    for (const [index, turn] of this.chat.slice().reverse().entries()) {
      const message = v_flex().px(8).py(7).gap(5).rounded(5).bg(t.raised)
        .child(div().font_semibold().child(turn.question))
        .child(div().text_size(11).text_color(t.muted).child(turn.run
          ? `Codex · 실행 ${turn.run.slice(0, 8)} · 케이스 ${turn.case_index + 1}` : "Codex · 개념 질문"))
        .child(div().child(turn.answer));
      if (turn.concept !== "none" && turn.concept_label) {
        message.child(div().text_size(11).text_color(t.accent).child(`복습 개념 · ${turn.concept_label}`));
      }
      if (turn.line && turn.run === this.runResult?.id && this.editor.value() === this.runSnapshot) {
        message.child(this.button(`chat-line-${index}`, `편집기 ${turn.line}행 보기`, (cx) => this.codeLine(turn, cx)));
      }
      history.child(message);
    }
    panel.child(history);
    if (this.chat.some((turn) => !["none", "other"].includes(turn.concept))) {
      panel.child(h_flex().child(this.button("chat-roadmap", "복습 로드맵 보기", (cx) => this.openRoadmap(cx))));
    }
    if (this.chatError) panel.child(div().text_color(t.blocked).child(this.chatError));
    if (allowed) {
      panel.child(div().text_size(11).text_color(t.muted).child(this.runResult
        ? `진단 대상 · 실행 ${this.runResult.id.slice(0, 8)} · 케이스 ${this.caseIndex + 1}`
        : "어떤 개념이 어려웠는지 설명해 주세요."));
      panel.child(Textarea.new(this.question).h(58).px(6).border(1).border_color(t.input).rounded(5));
      panel.child(h_flex().gap(6).flex_wrap()
        .child(this.button("chat-send", this.chatBusy ? "진단 중…" : "진단 요청", (cx) => this.ask(cx), true))
        .child(this.button("chat-understanding", "CLI로 이해 확인", (cx) => this.openCli(cx,
          "현재 개념을 이해했는지 확인할 짧은 예측 문제를 한 개 출제하고 답을 기다리기",
        ))));
    }
    return panel;
  }

  problemView(t) {
    const panel = v_flex().id("problem-reader").flex_1().min_w(0).min_h(0).gap(8).p(12)
      .border(1).border_color(t.border).rounded(6)
      .child(h_flex().gap(6).items_center().justify_between().flex_wrap()
        .child(div().font_semibold().child(this.title))
        .child(this.button("problem-source", "백준 원문 열기 ↗", (cx) => cx.open_url(this.original))))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button("problem-hint", "접근 힌트", (cx) => this.openCli(cx, "문제 접근 힌트", null, "hint")))
        .child(this.button("problem-concept", "알고리즘 개념", (cx) => this.openCli(cx, "핵심 알고리즘 개념", null, "concept"))));
    const selected = this.showReference ? null : this.runResult?.cases[this.caseIndex];
    const trace = selected ? selected.trace : this.referenceTrace;
    const visual = v_flex().id("concept-visualization").flex_1().min_h(0).gap(8).overflow_y_scrollbar();
    if (this.runResult) {
      const changeView = (isReference, cx) => {
        this.showReference = isReference;
        this.step = 0;
        cx.notify();
      };
      visual.child(h_flex().gap(6).flex_wrap()
        .child(this.button("reference-demo", this.referenceTrace ? "분기 예제" : "개념 그림",
          (cx) => changeView(true, cx), this.showReference))
        .child(this.button("reference-test", "선택한 테스트", (cx) => changeView(false, cx), !this.showReference)));
    }
    if (selected) {
      visual.child(div().text_size(11).text_color(t.muted).child(selected.name));
      return panel.child(visual.child(trace ? this.traceView(trace, t) : this.diagramView(selected.diagram, "test", t)));
    }
    if (trace) return panel.child(visual.child(this.traceView(trace, t)));
    if (this.lesson) {
      const generated = this.lesson.source === "generated";
      if (generated) visual.child(div().text_size(11).text_color(t.muted).child("AI 학습 예시"));
      visual.child(this.diagramView(this.lesson, "lesson", t));
      const actions = h_flex().gap(6).flex_wrap();
      if (generated && this.lesson.practice) {
        actions.child(this.button("practice-use", "연습 입력·기대 출력 채우기", (cx) => {
          if (this.pending) return;
          this.input.set_value(this.lesson.practice.input);
          this.expected.set_value(this.lesson.practice.expected);
          this.expectEmpty = !this.lesson.practice.expected;
          this.custom = true;
          cx.notify();
        }));
      }
      actions.child(this.button("lesson-edit", this.lessonEditing ? "닫기" : "다른 주제로 만들기", (cx) => {
        if (this.lessonBusy) return;
        this.lessonEditing = !this.lessonEditing;
        this.lessonMessage = "";
        cx.notify();
      }));
      visual.child(actions);
    }
    if (!this.lesson || this.lessonEditing) {
      visual.child(div().font_semibold().child("개념 시각화"))
        .child(Textarea.new(this.lessonHint).w_full().h(68).px(6).border(1).border_color(t.input).rounded(5))
        .child(h_flex().child(this.button("lesson-generate", this.lessonBusy ? "개념 그림 만드는 중…" : "개념 그림 만들기",
          (cx) => this.makeLesson(cx), true)));
      if (this.lessonMessage) {
        visual.child(div().text_size(12).text_color(this.lessonError ? t.blocked : t.muted).child(this.lessonMessage));
      }
    }
    return panel.child(visual);
  }

  editorView(t) {
    const actions = h_flex().gap(6).items_center().flex_wrap()
      .child(this.button("problem-save", "풀이 저장", (cx) => this.save(cx)))
      .child(this.button("problem-test", "테스트 실행", (cx) => this.test(cx), true));
    const status = this.pending && !this.ready ? "풀이를 불러오는 중…" : this.message;
    const panel = v_flex().flex_1().min_w(0).min_h(0).gap(8).p(12)
      .border(1).border_color(t.border).rounded(6)
      .child(h_flex().gap(8).items_center().justify_between().flex_wrap()
        .child(div().font_semibold().child(this.relativePath)).child(actions))
      .child(h_flex().gap(8).flex_wrap()
        .child(div().text_size(11).text_color(t.muted).child("Python 3"))
        .child(div().text_size(11).text_color(this.error ? t.blocked : t.muted).child(status))
        .child(div().text_size(11).text_color(t.accent).child(this.dirty ? "저장하지 않은 변경 사항" : "")));
    if (this.ready) {
      panel.child(Editor.new(this.editor).flex_1().min_h(60).border(1).border_color(t.border).rounded(6));
    }
    return panel;
  }

  render() {
    const t = theme();
    const view = v_flex().size_full().bg(t.surface).text_color(t.foreground).px(20).py(16).gap(12);
    if (!this.title) return view.child(this.message);
    view.id("workbench-root").on_size_change((size, cx) => {
      const wide = size.width >= 920;
      if (size.width !== this.width) { this.width = size.width; this.wide = wide; cx.notify(); }
    });

    const sideChat = this.wide && this.chatOpen;
    const chatOnly = !this.wide && this.narrowPane === "chat";
    const workWidth = this.width - (sideChat ? 302 : 0);
    const canSplit = workWidth >= 520;
    const header = h_flex().gap(8).items_center().justify_between().flex_wrap()
      .child(div().text_size(18).font_semibold().child("백준 Python"))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button("problem-chat", sideChat ? "진단 접기" : chatOnly ? "풀이 화면" : "풀이 진단", (cx) => {
          if (this.wide) this.chatOpen = !this.chatOpen;
          else this.narrowPane = chatOnly ? "editor" : "chat";
          cx.notify();
        }))
        .child(this.button("problem-cli", this.cliOpening ? "CLI 여는 중…" : "Codex CLI 열기", (cx) => this.openCli(cx), true)));
    view.child(header);
    if (this.cliMessage) view.child(div().text_size(12).text_color(t.accent).child(this.cliMessage));
    if (this.cliError) view.child(div().text_size(12).text_color(t.blocked).child(this.cliError));
    if (this.hintReviewPending && !this.cliOpening) {
      view.child(h_flex().child(this.button("retry-hint-review", "복습 기록 다시 저장", (cx) => this.retryHintReview(cx))));
    }
    if (chatOnly) return view.child(this.chatView(t));

    const workbench = v_flex().flex_1().min_h(0).min_w(0).gap(10);
    if (canSplit) {
      const leftWidth = Math.max(250, Math.min(540, Math.floor(workWidth * 0.54)));
      workbench.child(h_flex().items_stretch().gap(10).flex_1().min_h(100)
        .child(v_flex().w(leftWidth).min_h(0).child(this.problemView(t)))
        .child(this.editorView(t)));
    } else {
      workbench.child(h_flex().gap(6)
        .child(this.button("show-problem", "개념 시각화",
          (cx) => { this.narrowPane = "problem"; cx.notify(); }, this.narrowPane === "problem"))
        .child(this.button("show-editor", "편집기", (cx) => { this.narrowPane = "editor"; cx.notify(); }, this.narrowPane === "editor")));
      workbench.child(this.narrowPane === "problem" ? this.problemView(t) : this.editorView(t));
    }
    const testHeight = this.runResult
      ? (this.showTestOutput || this.custom ? 186 : 120)
      : (this.custom || !this.hasDefaultCases()) ? 134 : 80;
    workbench.child(v_flex().id("test-results").gap(8).p(10).h(testHeight).overflow_y_scrollbar()
      .border(1).border_color(t.border).rounded(6)
      .child(this.testsView(t)));
    const area = h_flex().items_stretch().gap(10).flex_1().min_h(0).child(workbench);
    if (sideChat) {
      area.child(v_flex().w(292).min_h(0).p(10).border(1).border_color(t.border).rounded(6).child(this.chatView(t)));
    }
    view.child(area);

    const official = h_flex().gap(8).items_center().child(div().text_size(11).text_color(t.muted).child(officialLabels[this.official]));
    if (!this.practice && this.official === "unconfirmed") {
      official.child(this.button("open-submit", "백준 제출 페이지", (cx) => cx.open_url(`https://acmicpc.net/submit/${this.problemId}`)))
        .child(this.button("mark-ac", "AC 확인함", (cx) => this.record("ac", cx)));
    }
    return view.child(official);
  }
}

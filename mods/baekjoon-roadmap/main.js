import { View, div } from "gpui-kit";
import { Editor, EditorState, Input, InputState, TextView, h_flex, v_flex } from "gpui-base";
import { checking, exec, focused, nextCommand, props, readTextFile, run, spaces, theme, watchFolder, writeTextFile } from "herdr";
import { platform } from "os";

const emptyRoadmap = "# 내 백준 로드맵\n\n## 1단계 · 학습 주제\n\n";
const problemURL = /^https?:\/\/(?:www\.)?acmicpc\.net\/problem\/([1-9][0-9]*)\/?(?:[?#].*)?$/i;
const bareProblemNumber = /^[1-9][0-9]*$/;

function validateRoadmap(text) {
  if (!/^#[ \t]+\S/m.test(text) || !/^##[ \t]+\S/m.test(text)) {
    return "제목(#)과 학습 단계(##)를 각각 한 줄 이상 입력하세요.";
  }
  return null;
}

export default class BaekjoonRoadmap extends View {
  init(_args, cx) {
    this.base = null;
    this.personal = null;
    this.showBase = false;
    this.editing = false;
    this.pending = true;
    this.message = "";
    this.error = false;
    this.recommendation = null;
    this.recommending = false;
    this.editor = EditorState.new({ language: "markdown", value: "", soft_wrap: true, folding: false });
    this.problem = InputState.new({ placeholder: "예: 2178 또는 백준 문제 링크" });
    this.problem.on("submit", (_event, context) => this.addProblem(context));

    if (checking()) {
      this.base = "# 백준 Python 8주 로드맵\n\n## 1단계 · 파이썬 기초";
      this.pending = false;
      return;
    }
    const project = props()?.project;
    if (typeof project !== "string" || !project) {
      this.pending = false;
      this.setMessage("저장소에서 ./setup을 실행해 로드맵을 연결하세요.", true);
      return;
    }
    this.project = project;
    this.basePath = `${project}/ROADMAP.md`;
    this.personalPath = `${project}/ROADMAP.local.md`;
    this.load(cx);
    cx.spawn(async (task) => {
      for (;;) {
        const command = await nextCommand();
        if (command !== "focus" || this.pending) continue;
        if (this.editing) this.editor.focus();
        else await this.refreshPersonal(task);
      }
    });
    if (platform() === "linux") {
      // Herdr's Linux folder watcher skips Git-ignored files such as ROADMAP.local.md.
      cx.timer.every(2000, (task) => {
        const shown = spaces().find((space) => space.active && space.folder === this.project);
        if (shown?.tabs.some((tab) => tab.active && tab.name === "백준 학습 로드맵")) return this.refreshPersonal(task);
      });
    } else {
      cx.spawn(async (task) => {
        for (;;) {
          this.personalWatch = watchFolder(this.project);
          let changed;
          try {
            changed = await this.personalWatch;
          } catch {
            return;
          }
          if (!changed.length) return;
          if (changed.includes(this.project) || changed.includes(this.personalPath)) await this.refreshPersonal(task);
        }
      });
    }
  }

  close() {
    this.personalWatch?.cancel();
  }

  async refreshPersonal(cx) {
    if (this.pending || this.editing) return;
    const snapshot = this.personal;
    try {
      const personal = await readTextFile(this.personalPath);
      if (this.pending || this.editing || this.personal !== snapshot || personal === snapshot) return;
      this.personal = personal;
      this.recommendation = null;
      cx.notify();
    } catch {
      this.setMessage("내 로드맵을 다시 읽을 수 없습니다.", true);
      cx.notify();
    }
  }

  async request(action, data) {
    const output = await exec("python3", ["study/workbench.py", action, JSON.stringify(data)],
      { cwd: this.project, timeout: 110000 });
    if (output.code !== 0) throw new Error("로드맵 작업을 실행할 수 없습니다.");
    const reply = JSON.parse(output.stdout);
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  }

  setMessage(message, error = false) {
    this.message = message;
    this.error = error;
  }

  load(cx) {
    this.pending = true;
    cx.spawn(async (task) => {
      try {
        [this.base, this.personal] = await Promise.all([
          readTextFile(this.basePath),
          readTextFile(this.personalPath),
        ]);
        this.setMessage(this.base === null ? "기본 ROADMAP.md 파일을 찾을 수 없습니다." : "", this.base === null);
      } catch {
        this.setMessage("로드맵을 읽을 수 없습니다. 저장소 경로와 파일을 확인하세요.", true);
      } finally {
        this.pending = false;
        task.notify();
      }
    });
  }

  beginEdit(text, cx) {
    this.editor.set_value(text);
    this.editor.set_selected_range({ start: text.length, end: text.length });
    this.problem.set_value("");
    this.editing = true;
    this.recommendation = null;
    this.setMessage("");
    cx.notify();
  }

  addProblem(cx) {
    if (!this.editing || this.pending) return;
    const value = this.problem.value().trim();
    const id = bareProblemNumber.test(value) ? value : value.match(problemURL)?.[1];
    if (!id) {
      this.setMessage("백준 문제 번호 또는 공식 문제 링크를 입력하세요.", true);
      cx.notify();
      return;
    }
    const text = this.editor.value();
    const caret = this.editor.selected_range().end;
    const lineEnd = text.indexOf("\n", caret);
    const position = lineEnd < 0 ? text.length : lineEnd;
    this.editor.set_selected_range({ start: position, end: position });
    this.editor.replace(`\n- [${id}번](https://acmicpc.net/problem/${id})`);
    this.problem.set_value("");
    this.setMessage(`${id}번을 추가했습니다. 저장하면 이 순서가 적용됩니다.`);
    this.editor.focus();
    cx.notify();
  }

  openLink(url, markdown, cx) {
    const id = url.match(problemURL)?.[1];
    if (!id) {
      cx.open_url(url);
      return;
    }

    const localSpaces = spaces().filter((space) => !space.machine);
    const space = localSpaces.find((item) => item.id === focused()?.space)
      ?? localSpaces.find((item) => item.folder === this.project);
    if (!space) {
      this.setMessage("학습 공간을 찾을 수 없습니다. 저장소에서 ./setup을 다시 실행하세요.", true);
      cx.notify();
      return;
    }

    const name = `백준 ${id}번`;
    const existing = space.tabs.find((tab) => tab.name === name);
    try {
      if (existing) {
        run("tab.select", { id: existing.id });
        return;
      }
      const links = markdown.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi);
      const label = Array.from(links).find((link) => link[2].match(problemURL)?.[1] === id)?.[1];
      run("tab.new", {
        space: space.id, name, mod: "baekjoon-problem",
        props: { project: this.project, problemId: id, title: label || name },
      });
    } catch (error) {
      this.setMessage(`문제 편집기를 열 수 없습니다. 저장소에서 ./setup을 다시 실행하세요. (${error.message})`, true);
      cx.notify();
    }
  }

  save(cx) {
    const text = this.editor.value();
    const invalid = validateRoadmap(text);
    if (invalid) {
      this.setMessage(invalid, true);
      cx.notify();
      return;
    }
    const next = text.trimEnd() + "\n";
    this.pending = true;
    cx.notify();
    cx.spawn(async (task) => {
      try {
        await writeTextFile(this.personalPath, next, this.personal);
        this.personal = next;
        this.editing = false;
        this.showBase = false;
        this.setMessage("내 로드맵을 저장했습니다. 다음 풀이부터 적용됩니다.");
      } catch {
        this.setMessage("저장할 수 없습니다. 파일이 바뀌었다면 초안을 복사한 뒤 취소하고 다시 여세요.", true);
      } finally {
        this.pending = false;
        task.notify();
      }
    });
  }

  recommend(cx) {
    if (this.recommending) return;
    const roadmap = this.personal ?? this.base;
    this.recommending = true;
    this.recommendation = null;
    this.setMessage("풀이 기록에서 반복된 개념을 확인하고 있습니다.");
    cx.notify();
    cx.spawn(async (task) => {
      try {
        const { problem, title, message } = await this.request("recommend", { roadmap });
        if (problem) this.recommendation = { problem, title, message, roadmap };
        this.setMessage(problem ? "" : message);
      } catch (error) {
        this.setMessage(error.message, true);
      } finally {
        this.recommending = false;
        task.notify();
      }
    });
  }

  applyRecommendation(cx) {
    const proposal = this.recommendation;
    const active = this.personal ?? this.base;
    if (!proposal || active !== proposal.roadmap || !bareProblemNumber.test(proposal.problem)) {
      this.setMessage("로드맵이 바뀌었습니다. 복습 추천을 다시 요청하세요.", true);
      this.recommendation = null;
      cx.notify();
      return;
    }
    this.recommendation = null;
    this.pending = true;
    cx.notify();
    cx.spawn(async (task) => {
      try {
        const plan = await this.request("review_plan", { problem: proposal.problem, title: proposal.title.slice(0, 200) });
        if (plan.active !== active) {
          this.personal = plan.previous;
          this.setMessage("로드맵이 바뀌었습니다. 복습 추천을 다시 요청하세요.", true);
        } else if (!plan.updated) {
          this.setMessage("이미 복습 우선 목록에 있는 문제입니다.");
        } else {
          await writeTextFile(this.personalPath, plan.updated, plan.previous);
          this.personal = plan.updated;
          this.showBase = false;
          this.setMessage("복습 우선 목록에 추가했습니다.");
        }
      } catch (error) {
        this.setMessage(error.message, true);
      } finally {
        this.pending = false;
        task.notify();
      }
    });
  }

  button(id, label, action, primary = false) {
    const t = theme();
    return div().id(id).px(12).py(7).rounded(6)
      .bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .hover((style) => style.bg(primary ? t.solid : t.hover))
      .child(label)
      .on_click((_event, cx) => { if (!this.pending) action(cx); });
  }

  render() {
    const t = theme();
    const view = v_flex().size_full().bg(t.surface).text_color(t.foreground).px(20).py(16).gap(12);
    const title = h_flex().justify_between().items_center().gap(12)
      .child(div().text_size(20).font_semibold().child("학습 로드맵"))
      .child(div().text_color(t.muted).text_size(12)
        .child(this.personal === null ? "사용 중 · 기본 8주" : "사용 중 · 내 로드맵"));
    view.child(title);

    if (this.pending && this.base === null) {
      return view.child(div().text_color(t.muted).child("로드맵을 불러오는 중…"));
    }
    if (this.message) {
      view.child(div().text_color(this.error ? t.blocked : t.accent).child(this.message));
    }
    if (this.recommendation && !this.editing) {
      const { title, message } = this.recommendation;
      view.child(v_flex().gap(5).px(10).py(8).bg(t.raised).rounded(6)
        .child(div().font_semibold().child(`복습 우선 · ${title}`))
        .child(div().child(message))
        .child(this.button("roadmap-apply-review", "로드맵에 복습 추가", (cx) => this.applyRecommendation(cx), true)));
    }
    if (this.editing) return view.child(this.editView(t));
    return view.child(this.readView(t));
  }

  readView(t) {
    if (this.base === null) return div();
    const actions = h_flex().gap(8);
    if (this.personal === null) {
      actions.child(this.button("roadmap-new", "새 로드맵 등록", (cx) => this.beginEdit(emptyRoadmap, cx), true))
        .child(this.button("roadmap-copy", "기본 8주 복사해 편집", (cx) => this.beginEdit(this.base, cx)));
    } else {
      actions.child(this.button("roadmap-edit", "내 로드맵 편집", (cx) => this.beginEdit(this.personal, cx), true))
        .child(this.button("roadmap-switch-preview", this.showBase ? "내 로드맵 보기" : "기본 8주 보기", (cx) => {
          this.showBase = !this.showBase;
          this.setMessage("");
          cx.notify();
        }));
    }
    actions.child(this.button("roadmap-recommend", this.recommending ? "검토 중…" : "복습 추천", (cx) => this.recommend(cx)));
    const text = this.showBase ? this.base : (this.personal ?? this.base);
    return v_flex().flex_1().min_h(0).gap(12)
      .child(actions)
      .child(this.showBase ? div().text_color(t.muted).child("기본 8주 로드맵 · 미리보기") : div())
      .child(div().id("roadmap-preview-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(TextView.markdown("roadmap-preview", text)
          .on_link_click((url, cx) => this.openLink(url, text, cx))));
  }

  editView(t) {
    return v_flex().flex_1().min_h(0).gap(10)
      .child(div().text_color(t.muted).child("제목은 #, 학습 단계는 ##로 작성하세요. 문제 순서는 본문에서 바꿀 수 있습니다."))
      .child(h_flex().items_center().gap(8)
        .child(Input.new(this.problem).flex_1().min_w(0).px(8).py(6)
          .border(1).border_color(t.input).rounded(6))
        .child(this.button("roadmap-add-problem", "커서 줄 아래에 문제 추가", (cx) => this.addProblem(cx))))
      .child(Editor.new(this.editor).flex_1().min_h(0).border(1).border_color(t.border).rounded(6))
      .child(h_flex().gap(8)
        .child(this.button("roadmap-save", this.pending ? "저장 중…" : "저장하고 사용", (cx) => this.save(cx), true))
        .child(this.button("roadmap-cancel", "편집 취소", (cx) => {
          this.editing = false;
          this.load(cx);
          cx.notify();
        })));
  }
}

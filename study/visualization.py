def row(label, values, focus=None):
    return {
        "label": label,
        "cells": [
            {"text": value, "state": "focus" if index == focus else "neutral"}
            for index, value in enumerate(values)
        ],
    }


def stage(title, action, reason, *rows):
    return {"title": title, "action": action, "reason": reason, "rows": list(rows)}


BUILTIN_LESSONS = {
    "2557": {
        "concept": "표준 출력",
        "overview": "입력을 읽는 단계 없이, 정해진 문자열 한 줄을 화면에 보냅니다.",
        "prediction": "느낌표를 빼면 기대 출력과 실제 출력이 어떻게 달라질까요?",
        "steps": [
            stage("입력 확인", "읽을 값이 없습니다.", "입력이 없는 문제에서는 input()을 호출할 필요가 없습니다.",
                  row("표준 입력", ["없음"])),
            stage("문자열 구성", "문장을 이루는 부분을 순서대로 살펴봅니다.",
                  "단어 사이에는 공백 하나가 있고, 마지막에는 느낌표가 들어갑니다.",
                  row("문자열", ["Hello", "공백", "World", "!"], 3)),
            stage("한 줄 출력", "문자열을 표준 출력에 보냅니다.", "출력의 글자와 순서가 기대값과 맞아야 합니다.",
                  row("표준 출력", ["Hello World!"], 0)),
        ],
    },
    "1000": {
        "concept": "문자열에서 정수 두 개 읽기",
        "overview": "입력 한 줄을 나눈 뒤 각 값을 정수로 바꿔 더합니다.",
        "prediction": "문자열 상태의 1과 2를 더하면 정수로 더했을 때와 어떻게 다를까요?",
        "steps": [
            stage("한 줄 읽기", "두 숫자가 공백으로 구분된 한 줄을 읽습니다.",
                  "처음 읽은 줄은 숫자 두 개가 아니라 문자열 하나입니다.", row("입력 줄", ["1 2"], 0)),
            stage("분리하고 정수로 변환", "공백을 기준으로 두 값을 나눈 뒤 정수로 바꿉니다.",
                  "정수로 바꾸면 +가 문자를 이어 붙이는 대신 덧셈을 합니다.",
                  row("문자열", ["'1'", "'2'"]), row("정수", ["1", "2"], 1)),
            stage("더해서 출력", "두 정수의 합을 한 줄로 출력합니다.", "문제는 입력 두 값의 합 하나를 요구합니다.",
                  row("계산", ["1", "+", "2", "=", "3"], 4)),
        ],
    },
}


def test_visualization(case):
    def display(value, empty="∅"):
        if len(value) > 140:
            return value[:140] + "\n…"
        return value or empty

    result, reason = {
        "pass": ("비교한 출력이 일치했습니다.", "입력을 바꿔도 같은 규칙을 만족하는지 확인해 보세요."),
        "wrong": ("비교한 출력이 다릅니다.", "두 출력에서 처음 달라지는 값이나 줄을 찾아보세요."),
        "error": ("실행 중 오류가 발생했습니다.", "오류 메시지가 가리키는 코드 줄과 그때 읽은 값을 확인해 보세요."),
        "timeout": ("정해진 시간 안에 종료되지 않았습니다.", "반복이나 재귀가 어떤 조건에서 끝나는지 확인해 보세요."),
        "output_limit": ("출력이 로컬 실행 제한을 초과했습니다.", "출력을 하는 코드가 예상보다 많이 실행되는지 확인해 보세요."),
    }[case["status"]]
    return {
        "concept": "입력에서 출력까지",
        "overview": "선택한 테스트의 입력과 결과를 함께 확인합니다.",
        "prediction": "입력에서 한 값을 바꾸면 기대 출력이 어떻게 달라질까요?",
        "steps": [
            stage("입력", "이 값을 Python 프로그램의 표준 입력으로 전달했습니다.",
                  "입력 형식과 코드가 읽어오는 값의 개수를 비교해 보세요.", row("전달한 입력", [display(case["input"])], 0)),
            stage("실행 결과", "실행 결과를 확인합니다.",
                  "오류가 있으면 오류 메시지를 먼저 확인합니다.",
                  row("실제 출력", [display(case["actual"])], 0),
                  *([row("오류", [display(case["stderr"])])] if case.get("stderr") else [])),
            stage("테스트 판정", result, reason,
                  row("기대 출력", [display(case["expected"])]), row("실제 출력", [display(case["actual"])], 0)),
        ],
    }


def object_schema(properties):
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


STRING = {"type": "string"}
CELL_STATES = ("neutral", "focus", "changed")
CELL = object_schema({"text": STRING, "state": {"type": "string", "enum": list(CELL_STATES)}})
ROW = object_schema({"label": STRING, "cells": {"type": "array", "items": CELL}})
STEP = object_schema({"title": STRING, "action": STRING, "reason": STRING, "rows": {"type": "array", "items": ROW}})
LESSON_PROPERTIES = {
    "status": {"type": "string", "enum": ["ready", "needs_context"]},
    "message": STRING,
    "concept": STRING,
    "overview": STRING,
    "prediction": STRING,
    "steps": {"type": "array", "items": STEP},
    "practice": {"anyOf": [object_schema({"input": STRING, "expected": STRING}), {"type": "null"}]},
}


def validate_lesson(lesson):
    def text(value, limit, allow_empty=False):
        if not isinstance(value, str) or len(value) > limit or (not allow_empty and not value.strip()):
            raise ValueError("개념 그림의 문장이나 값이 너무 길거나 비어 있습니다. 다시 만들어 주세요.")

    def items(value, minimum, maximum):
        if not isinstance(value, list) or not minimum <= len(value) <= maximum:
            raise ValueError("개념 그림의 단계 또는 칸 수가 범위를 벗어났습니다. 다시 만들어 주세요.")
        return value

    try:
        if lesson["status"] == "needs_context":
            text(lesson["message"], 240)
            return
        if lesson["status"] != "ready":
            raise ValueError("개념 그림의 상태를 확인할 수 없습니다.")
        text(lesson["concept"], 60)
        text(lesson["overview"], 160)
        text(lesson["prediction"], 140)
        for item in items(lesson["steps"], 2, 7):
            text(item["title"], 45)
            text(item["action"], 130)
            text(item["reason"], 180)
            for line in items(item["rows"], 1, 4):
                text(line["label"], 45)
                for cell in items(line["cells"], 1, 8):
                    text(cell["text"], 45)
                    if cell["state"] not in CELL_STATES:
                        raise ValueError("개념 그림의 강조 표시를 확인할 수 없습니다.")
        if lesson["practice"] is not None:
            text(lesson["practice"]["input"], 800, allow_empty=True)
            text(lesson["practice"]["expected"], 800, allow_empty=True)
    except (TypeError, KeyError) as error:
        raise ValueError("Codex가 만든 개념 그림 형식을 읽을 수 없습니다.") from error

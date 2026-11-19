"""Preview JSON question drafts against an existing HTML question bank.

Run: python3 tools/review_questions.py tcm/index.html drafts.json
Drafts are a JSON array of objects with question, answer and source.
The report goes to stdout. The quiz files are read-only.
"""

import argparse
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import unicodedata


def normalized(text):
    text = unicodedata.normalize("NFKC", text).casefold()
    return "".join(char for char in text if char.isalnum())


def answer_text(row):
    answer = row.get("answer", "")
    return next((label[2:] for key, label in row.get("options", []) if key == answer), answer)


def report(bank, drafts):
    previous = [(normalized(row["question"]), row) for row in bank]
    for index, draft in enumerate(drafts, 1):
        stem = normalized(draft["question"])
        matches = []
        for candidate, old in previous:
            score = SequenceMatcher(None, stem, candidate, autojunk=False).ratio()
            if score >= 0.74:
                conflict = score == 1 and normalized(answer_text(draft)) != normalized(answer_text(old))
                matches.append((score, old, conflict))
        matches.sort(key=lambda row: row[0], reverse=True)
        print(f"{index}. {draft['question']}")
        print(f"   来源：{draft.get('source') or '待补来源与页码'}")
        if not draft.get("answer"):
            print("   待补参考答案")
        for score, old, conflict in matches[:3]:
            status = "同题答案不同，需人工核对" if conflict else "题干相似"
            print(f"   {status}（{score:.0%}）：{old['question']}｜{old.get('source', '来源待查')}")
        previous.append((stem, draft))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bank", type=Path)
    parser.add_argument("drafts", type=Path)
    args = parser.parse_args()
    match = re.search(r'id="bank">(.*?)</script>', args.bank.read_text(encoding="utf-8"), re.S)
    if not match:
        parser.error("HTML missing embedded question bank")
    drafts = json.loads(args.drafts.read_text(encoding="utf-8"))
    if not isinstance(drafts, list) or any(
        not isinstance(row, dict) or not isinstance(row.get("question"), str)
        or not normalized(row["question"]) for row in drafts
    ):
        parser.error("Drafts must be a JSON array of objects with question text")
    report(json.loads(match[1]), drafts)

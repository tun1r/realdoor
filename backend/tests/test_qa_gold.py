import json


def test_all_gold_questions_match_expected_answers_and_rules(service, settings):
    records = [
        json.loads(line)
        for line in settings.qa_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(records) == 36

    sessions = {}
    for household_id in {record["household_id"] or "HH-001" for record in records}:
        state = service.create_demo_session(household_id)
        state = service.confirm(
            state.id,
            __import__("realdoor.models", fromlist=["ConfirmRequest"]).ConfirmRequest(),
        )
        sessions[household_id] = state.id

    for record in records:
        session_id = sessions[record["household_id"] or "HH-001"]
        result = service.answer_question(session_id, record["question"])
        assert result["answer"] == record["answer"], record["qa_id"]
        assert result["rule_ids"] == record["rule_ids"], record["qa_id"]
        assert [citation["rule_id"] for citation in result["rule_citations"]] == record["rule_ids"], record["qa_id"]

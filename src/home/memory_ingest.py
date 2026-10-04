"""Sessionless persistence hook: log each completed turn into Totem.

The chat transcript stays in the registry DB for UI replay; the durable,
cross-session knowledge lands here as a Totem memory. The agent also writes
its own finer-grained memories via the memory_create tool during the turn.
"""

from home import totem_store


def ingest_turn(project_dir, user_text: str, assistant_text: str) -> dict:
    title = "Conversation: " + user_text.strip().splitlines()[0][:80]
    statement = (
        f"Q: {user_text.strip()[:2000]}\n\n"
        f"A: {assistant_text.strip()[:2000]}"
    )
    return totem_store.create(
        project_dir,
        type="observation",
        title=title,
        statement=statement,
        tags=["conversation"],
        metadata={"observation": "chat_turn"},
        importance=0.3,
    )

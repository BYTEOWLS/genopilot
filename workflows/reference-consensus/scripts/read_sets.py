"""Project application-saved read sets into the workflow's numbered pair jobs.

This is a projection, not configuration validation or a scheduler.
"""


def execution_pairs(isolate: dict) -> list[dict]:
    return [
        {**pair, "read_set_id": read_set["id"], "library_id": read_set["library_id"],
         "read_group_id": f"{isolate['id']}.{read_set['id']}.{index}",
         "platform": read_set["platform"], "layout": read_set["layout"],
         "preprocessing": read_set["effective_preprocessing"]}
        for read_set in isolate["read_sets"]
        for index, pair in enumerate(read_set["read_pairs"], 1)
    ]

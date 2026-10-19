def checkout(items):
    if not items:
        raise ValueError("empty basket")
    return sum(items)


def receipt(items):
    return "Receipt\n" + "\n".join(str(i) for i in items)

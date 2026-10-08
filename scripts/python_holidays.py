"""Print python-holidays' Thai government holidays as JSON, for src/sources/python-holidays.ts.

Usage: python3 scripts/python_holidays.py 2569 2570    (Buddhist years)

Covers the `public` and `government` categories, which together are the days government
offices close (วันพืชมงคล is `government` only). Names are Thai; when two observances share a
date python-holidays joins them with "; ".
"""

import json
import sys

import holidays

BE_OFFSET = 543


def main(argv: list[str]) -> int:
    years_be = [int(arg) for arg in argv]
    if not years_be:
        print("usage: python_holidays.py YEAR_BE [YEAR_BE ...]", file=sys.stderr)
        return 2

    calendar = holidays.country_holidays(
        "TH",
        years=[year - BE_OFFSET for year in years_be],
        categories=("public", "government"),
        language="th",
    )
    rows = [{"date": day.isoformat(), "name_th": name} for day, name in sorted(calendar.items())]
    json.dump({"version": holidays.__version__, "holidays": rows}, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

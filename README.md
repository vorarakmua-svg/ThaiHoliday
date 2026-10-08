# ThaiHoliday

Thai government holidays (**วันหยุดราชการไทย**) as static JSON, collected automatically and
published to GitHub Pages.

Covers **พ.ศ. 2560–2570 (2017–2027)** — this year, next year, and ten years of history.

## Why this exists

Thai public holidays cannot simply be computed. A meaningful share of them depend on
**มติคณะรัฐมนตรี (ครม.)**, and the cabinet changes the calendar *during* the year it affects.
Two real examples from 2569 alone:

```
มติ ครม. 12 พ.ย. 2567  เพิ่มวันหยุดราชการปี 2569 เป็นกรณีพิเศษ 1 วัน คือ 2 ม.ค. 69
มติ ครม. 19 พ.ค. 2569  เพิ่มวันหยุดราชการปี 2569 เป็นกรณีพิเศษ 1 วัน คือ 16 ต.ค. 69
```

The second landed five months into the year it changed. Any library that ships a hardcoded
holiday table is wrong the moment ครม. meets.

So this repo watches for cabinet changes every day, and every data change arrives as a
**pull request you review** rather than a silent commit. Git history becomes an audit trail
of exactly when each holiday appeared.

## Using it

Everything is a plain JSON file over a CDN. `Access-Control-Allow-Origin: *` is set, so
browsers can fetch it directly.

```
https://vorarakmua-svg.github.io/ThaiHoliday/v1/index.json
https://vorarakmua-svg.github.io/ThaiHoliday/v1/holidays/2569.json
https://vorarakmua-svg.github.io/ThaiHoliday/v1/holidays/2026.json   # same year, Gregorian name
```

Each year is published under both its Buddhist and Gregorian year, because guessing wrong
is an off-by-543 bug that looks like an empty result.

```js
const res = await fetch('https://vorarakmua-svg.github.io/ThaiHoliday/v1/holidays/2026.json');
const { holidays } = await res.json();

const daysOff = holidays.filter((h) => h.is_day_off).map((h) => h.date);
```

### A holiday

```json
{
  "date": "2026-10-16",
  "date_be": "2569-10-16",
  "day_of_week": "friday",
  "key": "special_cabinet_holiday",
  "name_th": "วันหยุดพิเศษ (ครม.)",
  "name_en": "Special Cabinet Holiday",
  "type": "special_cabinet",
  "status": "confirmed",
  "is_day_off": true,
  "substitutes_for": null,
  "cabinet_resolution": {
    "date": "2026-05-19",
    "text": "มติ ครม. 19 พ.ค. 2569 เพิ่มวันหยุดราชการปี 2569 เป็นกรณีพิเศษ 1 วัน คือ 16 ต.ค. 69 ..."
  },
  "confirmed_by": ["myhora-html", "bot-html"]
}
```

| Field | Meaning |
| --- | --- |
| `key` | Stable slug. **Match on this**, not on Thai text — names vary between sources and years |
| `type` | `public` · `substitution` (ชดเชย) · `special_cabinet` (พิเศษ ครม.) · `royal` (พืชมงคล) |
| `status` | `confirmed`, or `provisional` if the year is not yet ratified by ครม. |
| `is_day_off` | **Read this one.** Whether government offices actually close |
| `substitutes_for` | For ชดเชย: the weekend observance being compensated |
| `cabinet_resolution` | The มติ ครม. behind a special holiday, with its date and verbatim text |
| `confirmed_by` | Which sources attested the date. More sources, more confidence |

### Two fields worth reading carefully

**`is_day_off` is not "is this a holiday".** An observance landing on a weekend is listed
with `is_day_off: false`, and the actual day off appears as a separate `substitution` entry.
วันแรงงาน (1 May) is also `false` — it is a holiday for banks and the private sector, but
government offices stay open. Filtering on `is_day_off` gives you the real days off.

**`status: "provisional"` means the year is a prediction.** ครม. usually ratifies the
following year around Nov–Dec. Until then, next year's lunar dates and any special holidays
can still move. Fixed statutory dates stay `confirmed` even in a provisional year, because
they do not depend on ครม. at all.

## How the data is collected

The guiding rule: **compute what is deterministic, scrape only what is not.**

Of ~22 annual holidays, 14 are fixed statutory dates computed in [`src/rules/fixed.ts`](src/rules/fixed.ts).
Three categories genuinely require a source:

| Category | Why it cannot be computed |
| --- | --- |
| มาฆบูชา, วิสาขบูชา, อาสาฬหบูชา, เข้าพรรษา | Thai lunar calendar, including **เดือนแปดสองหน** intercalation |
| วันพืชมงคล | Set annually by ประกาศสำนักพระราชวัง |
| วันหยุดพิเศษ (ครม.) | Cabinet discretion — unknowable in advance |

Sources are merged in strict precedence order:

```
data/overrides/*.yaml  →  myhora-html  →  myhora-ics  →  computed rules  →  google-ics
```

| Source | Role |
| --- | --- |
| [MyHora](https://myhora.com/calendar/) per-year page | **Primary.** Distinguishes ราชการ from ธนาคาร columns and prints the มติ ครม. notes |
| MyHora iCalendar | Cross-check. Current year only — the feed ignores every year parameter |
| [Bank of Thailand](https://www.bot.or.th/th/financial-institutions-holiday.html) | Second witness for special cabinet days |
| Google Thai holiday calendar | Date corroboration only. **Never** a source of names |
| Computed statutory rules | Corroboration; promoted to a real source only if the primary returns nothing |

### Why Google is corroboration-only

Its feed is demonstrably unreliable for this purpose. It omits **วันเข้าพรรษา** entirely,
labels the 2 ม.ค. 2569 cabinet holiday `"วันหยุดราชการธันวาคม"`, calls both 2568 cabinet
holidays a bare `"นักขัตฤกษ์"`, misspells New Year as `"วันขื้นปีใหม่"`, and lists วันแรงงาน as
a public holiday. It is useful for confirming that a date exists and for nothing else.

### Two things the collector deliberately will not do

**It will not reinstate a holiday ครม. cancelled.** When a fixed statutory date is missing
from every source, that is usually a cancellation, not a failed scrape — ครม. postponed
Songkran 2563 for COVID. The rules layer raises a warning and leaves the day out.

**It will not promote a regional holiday to a national one.** ครม. also grants
วันหยุดราชการประจำภาค — days off in one region only. The 29 ธ.ค. 2563 resolution grants four
national holidays and five regional ones in a single sentence. Regional grants are skipped
and reported.

## Working on it

```bash
npm install
npm test                          # 88 tests, all offline against vendored fixtures
npm run typecheck
```

```bash
npx tsx src/cli.ts verify 2569    # collect one year live and print it; writes nothing
```

```bash
npx tsx src/cli.ts refresh --dry-run
```

Prints the pull request body it *would* post. Against committed data it should report no
changes.

| Command | Purpose |
| --- | --- |
| `refresh [--dry-run] [--years=…]` | Re-collect changeable years and render a PR body |
| `watch [--years=…]` | Compare CI-reachable sources against committed data. Reports only |
| `verify [YEAR_BE]` | Collect one year live, print it, write nothing |
| `validate` | Check every file in `data/` and `data/overrides/` against the schema and sanity rules |
| `build` | Copy `data/` into `public/v1` for GitHub Pages |
| `freeze --years=2560-2568` | Mark finished years settled so the bot leaves them alone |

Tests never touch the network — [`test/fixtures/`](test/fixtures) holds vendored copies of
every source.

### How updates actually reach the repo

MyHora is unreachable from GitHub's hosted runners. Cloudflare serves an interstitial
challenge to datacenter addresses, so both MyHora endpoints answer `403` there while
returning `200` from an ordinary connection. Measured from a runner on 2026-08-20:

| Source | Your machine | GitHub Actions |
| --- | --- | --- |
| MyHora page / iCal | 200 | **403** |
| Bank of Thailand | 200 | 200 |
| Google calendar | 200 | 200 |

This project does not try to defeat that challenge. The work is split instead:

- **[`watch.yml`](.github/workflows/watch.yml) runs daily in CI** using only BOT and Google.
  BOT follows ครม. for one-off grants, so a fresh มติ ครม. still surfaces within a day. When
  it sees a day this repo lacks, it opens an issue labelled `holiday-watch` — and
  `cabinet-change` when BOT is the one reporting it. An unchanged discrepancy is reported
  once, not every morning. If the BOT page cannot be read, the run fails rather than
  passing quietly, so a blind watchdog is visible. It never edits data.
- **`npm run refresh` runs where MyHora is reachable** — your machine, or a self-hosted
  runner. If MyHora answers with a page that has no calendar rows, refresh fails instead of
  writing a year rebuilt from the statutory rules alone. That is the only place the lunar dates, วันพืชมงคล and the มติ ครม. notes can be
  re-read. Review the diff, then push it as a pull request.

[`refresh.yml`](.github/workflows/refresh.yml) is therefore manual-only. Point its `runner`
input at a self-hosted label and it works end-to-end unchanged.

The watchdog deliberately ignores วันแรงงาน and its compensatory day: Google counts both as
public holidays, they are working days for government offices, and reporting them every year
would train you to ignore the alert.

### Overrides

`data/overrides/<yearBe>.yaml` sits above every scraped source. It is the route for anything
the collector cannot reach on its own, and every entry must carry a `note` saying why.
Unknown keys and dates outside the file's year are errors, and `npm run validate` checks
every override file, so a typo fails CI instead of silently not applying:

```yaml
add:
  - date: 2026-10-16
    name_th: วันหยุดพิเศษ (ครม.)
    type: special_cabinet
    cabinet_resolution:
      date: 2026-05-19
      text: มติ ครม. 19 พ.ค. 2569 เพิ่มวันหยุดราชการปี 2569 เป็นกรณีพิเศษ 1 วัน คือ 16 ต.ค. 69
    note: Announced on soc.go.th, which cannot be read automatically.
```

### Frozen years

Years before the current one are marked `"frozen": true`. The refresh bot skips them and CI
fails if one changes, so settled history cannot be quietly rewritten by a source that
altered its markup. Run `freeze` each January for the year just ended.

## Known limitations

**soc.go.th is not machine-readable.** สำนักเลขาธิการคณะรัฐมนตรี is the actual legal authority,
and both it and ratchakitcha.soc.go.th sit behind a Cloudflare interstitial challenge. This
project does not attempt to defeat that. When an announcement appears only there, a human
adds it through `data/overrides/`.

**MyHora is a third party**, with no SLA and no data licence. It is a genuinely excellent
Thai calendar and this project leans on it heavily — please credit it if you build on this.
If it ever disappears, the fixed statutory rules keep working and the lunar and ครม. days
degrade to warnings rather than vanishing silently.

**`substitutes_for` is inferred, not stated.** No source says which observance a ชดเชย day
compensates. It is paired with the nearest preceding weekend holiday. When ครม. grants fewer
substitutions than there were weekend holidays — as in 2567 — attribution between two
adjacent days is genuinely ambiguous.

**Next year is a prediction until ครม. ratifies it.** The `status` field says so. Consumers
who ignore it will be wrong roughly every Q4.

## Data sources and credit

- [MyHora.com](https://myhora.com/calendar/) — primary calendar data
- [Bank of Thailand](https://www.bot.or.th/th/financial-institutions-holiday.html) — cabinet holiday announcements
- Google Thai holiday calendar — date corroboration

Holiday data itself is factual public information. The code in this repository is MIT
licensed.

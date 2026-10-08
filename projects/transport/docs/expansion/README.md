# Transport Expansion — Phase 1

| File | What it is |
|---|---|
| `00-EXPANSION-PLAN.md` | The full plan: phases, costs, additions, blind spots, decisions |
| `one-pager.html` | The one-page proposal for leadership (source) |
| `one-pager.pdf` | Print-ready A4, generated from the HTML |
| `make-pdf.sh` | Regenerates the PDF after editing the HTML |

## Regenerating the PDF

```
./make-pdf.sh
```

Renders `one-pager.html` to `one-pager.pdf` at A4 portrait using headless Chrome, with no
browser header or footer. It prints the page count afterwards — if that ever says 2, the
content has outgrown the page and needs trimming rather than shrinking.

Editing the wording is safe; the layout is sized so there is a little slack. The things most
likely to push it onto a second page are the four phase descriptions and the three
commitment cards.

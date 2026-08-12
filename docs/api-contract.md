# LeadMachine — חוזה ה-API והמערכת (כפי שנצפה מה-production)

> מסמך שחזור. קוד הפונקציות המקורי חי רק ב-deployment של Vercel (פרויקט `leadmachine`,
> team `asafs-projects-a225bf53`) ולא היה שמור בגיט. המסמך הזה מתעד את החוזה המדויק
> כפי שנצפה מהדשבורד, מה-DB החי ומהתנהגות ה-endpoints — כדי שאפשר יהיה לתחזק,
> להרחיב או לשחזר את הקוד בבטחה.

## פריסה

| רכיב | איפה |
|---|---|
| Frontend + API | Vercel, פרויקט `leadmachine` (7 פונקציות Node) — `leadmachine-gamma.vercel.app` |
| DB | Cloudflare D1 `leadmachine-db` (`bce5b2af-1852-4aa0-a084-ecba3d3f3933`) |
| Cron | Vercel cron יומי, בפועל רץ ~09:32 UTC (מוגדר 09:00) → `/api/cron/harvest` |
| Probe (עזר) | Vercel, פרויקט `leadmachine-probe` — fetch tester למקורות חיצוניים |

## אימות

כל ה-endpoints מחזירים `401 {"error":"unauthorized"}` בלי header בשם `x-api-key`.
המפתח שמור אצל המשתמש (localStorage בדשבורד בשם `lm_key`). ה-cron של Vercel עובר
כנראה דרך מנגנון נפרד (header של Vercel cron או secret פנימי).

## Endpoints (נצפו מקוד הדשבורד)

| Method + Path | מה עושה |
|---|---|
| `GET /api/leads?county=&min_score=&status=` | רשימת לידים + `stats: {total, available, avg_score}` |
| `POST /api/ingest` body: `{source, rows:[...]}` | קליטת שורות (עד 50 לבקשה מהדשבורד). מחזיר `{inserted, merged}` — **merged = signal-stacking**: שורה שכתובתה כבר קיימת ממזגת סיגנלים ומעדכנת ציון במקום ליצור כפילות |
| `GET /api/cron/harvest` | מריץ קציר מכל ה-sources הפעילים. מחזיר `{report:[{source, inserted, merged, error?}]}` |
| `GET /api/cron/harvest?log=1` | מחזיר `{log:[{ran_at, source, fetched, inserted, merged, ok, note}]}` |
| `GET /api/export?county=&min_score=&status=` | CSV (`text/csv`) |
| `GET /api/buyers` / `POST /api/buyers` | רשימה / הוספת קונה `{name, company, email, vertical, price_per_lead}` |

## חוזה ה-sources (מנוע הקציר)

הקציר הוא data-driven: כל שורה ב-`sources` מגדירה מקור. הוספת מחוז = INSERT, בלי deploy.

- `url_template` — URL מלא של שאילתת ArcGIS/JSON עם placeholder ‏`{cutoff_date}` שמוחלף
  בתאריך `YYYY-MM-DD` ‏(היום פחות `lookback_days`). פורמט התאריך ב-where של ArcGIS:
  `DATE '{cutoff_date}'` (מקודד URL).
- `field_map` — JSON שממפה שדות שלנו → שדות במקור: `{"owner","address","city","zip"}`;
  רק `address` חובה. (דוגמה: Cape Coral ממפה את כולם; Miami-Dade רק address.)
- `signal` — הסיגנל שמוצמד לכל רשומה מהמקור (למשל `code_violation`, `tax_delinquent`).
- דה-דופליקציה לפי `address_key` (נגזרת מנורמול הכתובת). רשומה קיימת → merge
  (הוספת סיגנל חדש ל-signals + עדכון ציון), רשומה חדשה → insert בציון הסיגנל.

## סיגנלים חוקיים (מתוך הדשבורד)

`lis_pendens, pre_foreclosure, probate, inherited, tax_delinquent, divorce,
code_violation, vacant, tired_landlord, absentee`

ניקוד: סיגנל `code_violation` בודד = 15. משקלות שאר הסיגנלים חיים בקוד הפרוס
(לא שוחזרו עדיין — לוודא מול התנהגות merge אמיתית כשיהיה stacking פעיל).

## מקורות פעילים (נכון ל-12.08.2026)

| name | county | signal | הערות |
|---|---|---|---|
| `capecoral_code_open` | Lee | code_violation | ArcGIS של Cape Coral; field_map מלא (owner/city/zip) |
| `mdc_code_violations` | Miami-Dade | code_violation | ArcGIS county; address בלבד — owner/zip מגיעים מהעשרה |

## פערים ידועים

1. **קוד הפונקציות לא בגיט** — הריפו הזה מכיל שחזור של הדשבורד (verbatim) ותיעוד
   החוזה; קוד ה-API עצמו טרם שוחזר. לפני deploy מחדש חובה לוודא את שמות משתני
   הסביבה ב-Vercel (CF account id / API token / D1 id / API key).
2. **אין enrichment בקוד הפרוס** — העשרת owner/zip ל-Miami-Dade רצה כתהליך חיצוני
   (ראו `scripts/`).
3. **אין עמודת folio ב-leads** — הצלבה ל-Property Appraiser נעשית דרך כתובת/re-fetch.

# LeadMachine FL

מכונת לידים אוטומטית לנדל"ן במצוקה בפלורידה: איסוף יומי מ-public records, ניקוד
לפי סיגנלים מוצלבים, והפצה לקונים בכמה ורטיקלים.

**עקרונות:** מוכרים דאטה בלבד (חבות TCPA אצל הקונה) · איכות לפני נפח · לא בונים
מערכת הפצה (ping tree) לפני שיש 3+ קונים פעילים.

## מבנה הריפו

| תיקייה | תוכן |
|---|---|
| `db/schema.sql` | סכמת ה-D1 (שוחזרה verbatim מהמסד החי) |
| `dashboard/index.html` | הדשבורד הפרוס ב-production (שוחזר verbatim) |
| `docs/api-contract.md` | חוזה ה-API וה-sources המלא, כפי שנצפה מה-production |
| `docs/scoring.md` | משקלות הסיגנלים והניקוד |
| `probe/` | פונקציית probe (Vercel) לבדיקת מקורות דאטה חיצוניים |
| `scripts/` | סקריפטים חד-פעמיים: העשרת Miami-Dade, הוספת sources |

## ארכיטקטורה (בקצרה)

```
county open data (ArcGIS/JSON)
        │  cron יומי ~09:32 UTC (Vercel)
        ▼
/api/cron/harvest ──► sources table (data-driven: מקור חדש = INSERT, בלי deploy)
        │  normalize address → address_key → dedup/merge (signal stacking)
        ▼
Cloudflare D1: leads (score, signals[]) · buyers · deliveries · harvest_log
        │
        ▼
/api/leads · /api/export (CSV) · דשבורד עם API key
```

הפרטים המלאים — `docs/api-contract.md`.

## סטטוס (12.08.2026)

- **חי:** קציר יומי משני מקורות (Cape Coral/Lee, Miami-Dade) — 974 לידים.
- **בעבודה:** העשרת owner/mailing ל-Miami-Dade, ‏signal stacking ‏(tax delinquent,
  absentee), מחוזות נוספים.
- **פתוח:** קונים (טבלת buyers ריקה) — 4 תשובות מהקונה הראשון, ואז מנוע 2 (ציד קונים).

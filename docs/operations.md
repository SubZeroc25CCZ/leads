# תפעול רציף — מי מריץ מה ומתי

המערכת רצה בשלוש לולאות אוטומטיות. אין שלב ידני בשגרה.

## לולאה 1 — קציר (Vercel cron, ~09:32 UTC יומי)

`/api/cron/harvest` בפרויקט `leadmachine` רץ על כל שורה פעילה ב-`sources`:
מוריד רשומות מאז `{cutoff_date}`, מנרמל כתובת, insert/merge, ורושם ל-`harvest_log`.
מקורות שאינם ArcGIS עוברים דרך ה-adapter (`probe/api/adapter.js`).

## לולאה 2 — העשרה ו-QA (Claude Routine יומי, 10:00 UTC)

session חדש שנפתח אוטומטית כל יום: בדיקת קציר (השבתת מקור אחרי 3 כשלים),
QA כתובות (invalid), העשרת Miami-Dade (FOLIO -> Property Appraiser, absentee -> ציון 30),
ודוח.

## לולאה 3 — גיבוי קוד

כל שינוי קוד/סכמה מקומט ל-`SubZeroc25/leads` בענף העבודה. deploy של ה-probe
עם `deploy_to_vercel` (פרויקט `leadmachine-probe`).

## נקודות תורפה ידועות

- קוד ה-harvester הפרוס לא בגיט — החוזה מתועד ב-api-contract.md.
- מפתח ה-API של הדשבורד לא בידי האוטומציה — האוטומציה עוקפת דרך D1 ישירות.
- PaGISView מתעדכן שבועי — לידים חדשים מחכים עד שבוע להעשרה; ה-Routine מנסה כל יום.
- ה-secret של ה-probe מוטמע בקוד — סיכון נמוך (קריאת דאטה ציבורית).

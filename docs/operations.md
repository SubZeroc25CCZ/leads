# תפעול רציף — מי מריץ מה ומתי

המערכת רצה בשלוש לולאות אוטומטיות. אין שלב ידני בשגרה.

## לולאה 1 — קציר (Vercel cron, ~09:32 UTC יומי)

`/api/cron/harvest` בפרויקט `leadmachine` רץ על כל שורה פעילה ב-`sources`:
מוריד רשומות מאז `{cutoff_date}`, מנרמל כתובת → `address_key`, insert חדשים /
merge קיימים, ורושם ל-`harvest_log`. מקורות שאינם ArcGIS עוברים דרך ה-adapter
(`probe/api/adapter.js`) שמחזיר להם צורת ArcGIS.

## לולאה 2 — העשרה ו-QA ‏(Claude Routine יומי, 10:00 UTC)

session חדש שנפתח אוטומטית כל יום ומבצע:
1. **בדיקת קציר**: `harvest_log` של 24 השעות האחרונות — מקור שנכשל (ok=0) מסומן
   ומדווח; מקור שנכשל 3 ימים ברצף מושבת (enabled=0) עם הערה.
2. **QA כתובות**: לידים חדשים עם כתובת לא-שמישה (`% - %`, `NO ADDRESS`,
   `EXEMPT FROM PUBLIC RECORDS`) → status='invalid'.
3. **העשרת Miami-Dade**: לידים חדשים בלי owner → ‏`probe/api/mdc-enrich`
   (FOLIO → Property Appraiser) → עדכון owner/city/zip, ו-absentee מוסיף סיגנל
   ומעלה ציון ל-30 (לפי `docs/scoring.md`).
4. **דוח**: סיכום קצר של המספרים (חדשים, הועשרו, absentee, נכשלו).

## לולאה 3 — גיבוי קוד (ידני-למחצה)

כל שינוי קוד/סכמה מקומט ל-`SubZeroc25/leads` בענף העבודה. ה-deploy של
ה-probe נעשה עם `deploy_to_vercel` (פרויקט `leadmachine-probe`).

## נקודות תורפה ידועות

| סיכון | מיטיגציה |
|---|---|
| קוד ה-harvester הפרוס לא בגיט | החוזה מתועד ב-`docs/api-contract.md`; שחזור מלא = משימה פתוחה |
| מפתח ה-API של הדשבורד לא בידי האוטומציה | כל האוטומציה עוקפת את ה-API (D1 ישירות + cron פנימי); להפעלת קציר ידנית צריך את המפתח מהדשבורד |
| PaGISView מתעדכן שבועי (שבת) | לידים חדשים מאוד עשויים לחכות עד שבוע להעשרה — ה-Routine מנסה שוב כל יום |
| ה-secret של ה-probe מוטמע בקוד | סיכון נמוך (רק קריאת דאטה ציבורית); רוטציה = החלפת קבוע + redeploy |

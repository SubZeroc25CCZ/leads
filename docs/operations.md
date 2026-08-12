# תפעול — אוטומציה מלאה

המערכת מריצה את עצמה. שתי לולאות אוטומטיות מכסות את כל הפייפליין; המגע הידני
היחיד שנשאר הוא **אישור שליחת outreach** (מכוון — מוניטין דומיין ו-CAN-SPAM).

## לולאה 1 — קציר (Vercel cron, server-side, ~09:32 UTC יומי)

`/api/cron/harvest` בפרויקט `leadmachine` רץ ללא Claude בכלל: עובר על כל שורה
פעילה ב-`sources`, מוריד מאז `{cutoff_date}`, מנרמל כתובת → `address_key`,
insert/merge, ורושם ל-`harvest_log`. מקורות שאינם ArcGIS (Orlando) עוברים דרך
ה-adapter ב-`leadmachine-probe`. זו הלולאה שמייצרת נפח — אוטונומית לגמרי.

## לולאה 2 — מחזור יומי מלא (Claude Routine, יומי ~10:04 UTC)

טריגר `trig_01KsPUKJpqodbb4zcYF34shJ` ("LeadMachine — full daily automation")
קשור ל-**סשן הפרויקט הקבוע** (session_01QMXJBqPpz3VSwCWqu6f4ws) — לכן לכל ריצה
יש גישה מלאה ל-MCP (Cloudflare D1, Vercel, AgentMail, GitHub). רץ ~30 דקות אחרי
הקציר ומבצע:

1. **בדיקת קציר** — `harvest_log` של 24 שעות; מקור שנכשל 3 ימים ברצף מושבת
   אוטומטית (`enabled=0`) ומדווח.
2. **QA כתובות** — כתובות לא-שמישות (`% - %`, `NO ADDRESS`,
   `EXEMPT FROM PUBLIC RECORDS`) → `status='invalid'`.
3. **העשרת Miami-Dade** — לידים חדשים בלי owner → ‏`/api/mdc-enrich`
   (FOLIO → Property Appraiser) → owner/city/zip, ו-absentee → סיגנל + ציון 30.
4. **גילוי קונים (שבועי, ימי ב')** — `/api/buyer-hunt` → קונים חדשים שלא בטבלה
   נכנסים כ-`prospect`.
5. **ניטור תיבה** — הודעות חדשות ב-`leadmachine@agentmail.to`; תגובת קונה מסוכמת
   ובמידת הצורך נכתבת טיוטת תשובה — **בלי שליחה** (אישור אנושי חובה).
6. **רענון דשבורד** — פרסום מחדש של ה-Artifact עם המספרים העדכניים.
7. **דחיפת קוד** — commitים ממתינים נדחפים ל-`SubZeroc25/leads` אם GitHub זמין.

## הקו האדום היחיד שנשאר ידני

**שליחת מיילים לקונים.** המערכת מכינה drafts (מנוע 2) ומסכמת תגובות, אבל שליחה
בפועל דורשת אישור מפורש. הכל מוכן ללחיצת כפתור; אף מייל לא יוצא לבד.

## נקודות תורפה ידועות

| סיכון | מיטיגציה |
|---|---|
| הסשן הקבוע נרקלם (מיכל ephemeral) | טריגרים קשורי-סשן מקימים אותו מחדש בכל ריצה (מוכח מול ה-reminders) |
| קוד ה-harvester הפרוס לא בגיט | החוזה מתועד ב-`docs/api-contract.md` |
| PaGISView מתעדכן שבועי (שבת) | לידים חדשים מחכים עד שבוע להעשרה — הלולאה מנסה כל יום |
| ה-secret של ה-probe מוטמע בקוד | סיכון נמוך (קריאת דאטה ציבורית); רוטציה = החלפת קבוע + redeploy |
| הגדרת enrichment ל-Orange/Broward | Deerfield כבר מביא owner/zip; Orlando address-only — enrichment ל-Orange טרם נבנה |

## הפעלה/כיבוי

- להשבית זמנית: `update_trigger enabled=false` על `trig_01KsPUKJpqodbb4zcYF34shJ`.
- לשנות שעה/תדירות: `update_trigger cron_expression`.
- הקציר (לולאה 1) נשלט מ-Vercel (פרויקט `leadmachine`), לא מכאן.
